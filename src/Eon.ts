import { FileSink, Glob } from "bun";
import { AsyncLocalStorage } from "async_hooks";
import { _WSContext, _HTTPContext } from "./types/general";
import { generateHeapSnapshot } from "bun"

export default class Tak {

    private static indexedRoutes = new Map<string, Map<string, Function>>()

    private static routeSlugs = new Map<string, Map<string, number>>()

    private static allMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

    private static hasMiddleware = false

    private static logDestination = process.env.LOG_PATH

    private static heapDestination = process.env.HEAP_PATH

    private static headers: HeadersInit = {
        "Access-Control-Allow-Headers": process.env.ALLOW_HEADERS || "",
        "Access-Control-Allow-Origin": process.env.ALLLOW_ORGINS || "",
        "Access-Control-Allow-Credential": process.env.ALLOW_CREDENTIALS || "false",
        "Access-Control-Expose-Headers": process.env.ALLOW_EXPOSE_HEADERS || "",
        "Access-Control-Max-Age": process.env.ALLOW_MAX_AGE || ""
    }

    private static readonly UPGRADE = 'Upgrade'

    static Context = new AsyncLocalStorage<_HTTPContext>()

    private static getSlugs(request: Request) {

        const slugs = new Map<string, any>()

        const url = new URL(request.url)

        const paths = url.pathname.split('/')

        for(const [slugKey, slugMap] of Tak.routeSlugs) {

            const idx = paths.findLastIndex((seg) => slugKey.endsWith(`${seg}.ts`))

            if(slugKey.startsWith(paths[1]) && idx > -1) {

                slugMap.forEach((idx, key) => slugs.set(key, paths[idx + 1]))
                
                break
            }
        }

        return slugs
    }

    private static getHandler() {

        const { request } = Tak.Context.getStore()!

        const url = new URL(request.url)

        let handler = undefined

        let params: string[] = []

        const paths = url.pathname.split('/')

        const allowedMethods: string[] = []

        for(const [routeKey, routeMap] of Tak.indexedRoutes) {

            const idx = paths.findLastIndex((seg) => routeKey.endsWith(`${seg}.ts`))

            if(routeKey.startsWith(paths[1]) && idx > 1) {

                handler = routeMap.get(request.method)

                routeMap.forEach((_, key) => {
                    if(Tak.allMethods.includes(key)) allowedMethods.push(key)
                })

                if(paths[idx + 1] !== undefined) params = paths.slice(idx + 1)
                
                break
            }
        }

        Tak.headers = {...Tak.headers, "Access-Control-Allow-Methods": allowedMethods.join(',') }

        if(handler === undefined) throw new Error(`Route ${url.pathname} not found`, { cause: 404 })

        return { handler, params: Tak.parseParams(params) }
    }

    private static formatDate() {
        return new Date().toISOString().replace('T', ' ').replace('Z', '')
    }

    private static formatMsg(msg: any) {

        if(msg instanceof Set) return "\n" + JSON.stringify(Array.from(msg), null, 2)
        
        else if(msg instanceof Map) return "\n" + JSON.stringify(Object.fromEntries(msg), null, 2)

        else if(msg instanceof FormData) {
            const formEntries: Record<string, any> = {}
            msg.forEach((val, key) => formEntries[key] = val)
            return "\n" + JSON.stringify(formEntries, null, 2)
        }

        else if(Array.isArray(msg) 
            || msg instanceof Array 
            || (typeof msg === 'object' && !Array.isArray(msg))
            || (typeof msg === 'object' && msg !== null)) return "\n" + JSON.stringify(msg, null, 2) 

        return msg
    }

    private static configLogger() {

        const logger = console

        const reset = '\x1b[0m'

        console.info = (msg) => {
            const info = `[${Tak.formatDate()}]\x1b[32m INFO${reset} (${process.pid}) ${Tak.formatMsg(msg)}`
            logger.log(info)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`${info.replace(reset, '').replace('\x1b[32m', '')}\n`)
            }
        }

        console.error = (msg) => {
            const err = `[${Tak.formatDate()}]\x1b[31m ERROR${reset} (${process.pid}) ${Tak.formatMsg(msg)}`
            logger.log(err)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`${err.replace(reset, '').replace('\x1b[31m', '')}\n`)
            }
        }

        console.debug = (msg) => {
            const bug = `[${Tak.formatDate()}]\x1b[36m DEBUG${reset} (${process.pid}) ${Tak.formatMsg(msg)}`
            logger.log(bug)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`${bug.replace(reset, '').replace('\x1b[36m', '')}\n`)
            }
        }

        console.warn = (msg) => {
            const warn = `[${Tak.formatDate()}]\x1b[33m WARN${reset} (${process.pid}) ${Tak.formatMsg(msg)}`
            logger.log(warn)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`${warn.replace(reset, '').replace('\x1b[33m', '')}\n`)
            }
        }

        console.trace = (msg) => {
            const trace = `[${Tak.formatDate()}]\x1b[35m TRACE${reset} (${process.pid}) ${Tak.formatMsg(msg)}`
            logger.log(trace)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`${trace.replace(reset, '').replace('\x1b[35m', '')}\n`)
            }
        }
    }

    private static async processRequest() {

        const { request } = Tak.Context.getStore()!

        const { handler, params } = Tak.getHandler()

        const body = await request.blob()

        let data: Blob | Record<string, any> | undefined

        if(body.size > 0) {

            if(body.type.includes('form')) data = Tak.parseKVParams(await body.formData())
            else {
                try {
                    data = await body.json()
                } catch {
                    data = body
                }
            }
        }

        const searchParams = new URL(request.url).searchParams

        let queryParams: Record<string, any> | undefined;

        if(searchParams.size > 0) queryParams = Tak.parseKVParams(searchParams)

        if(params.length > 0 && !queryParams && !data) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params))
            }

            return await handler(...params)

        } else if(params.length === 0 && queryParams && !data) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(queryParams))
            }

            return await handler(queryParams)

        } else if(params.length === 0 && !queryParams && data) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(data))
            }

            return await handler(data)

        } else if(params.length > 0 && queryParams && !data) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, queryParams))
            }

            return await handler(...params, queryParams)
        
        } else if(params.length > 0 && !queryParams && data) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, data))
            }

            return await handler(...params, data)

        } else if(params.length === 0 && data && queryParams) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(queryParams, data))
            }

            return await handler(queryParams, data)
        
        } else if(params.length > 0 && data && queryParams) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, queryParams, data))
            }

            return await handler(...params, queryParams, data)
        
        } else {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler())
            }

            return await handler()
        }
    }

    private static isAsyncIterator(data: any) {
        return typeof data === "object" && Object.hasOwn(data, Symbol.asyncIterator)
    }

    private static hasFunctions(data: any) {
        return typeof data === "object" && (Object.keys(data).some((elem) => typeof elem === "function") || Object.values(data).some((elem) => typeof elem === "function"))
    }

    private static processResponse(status: number, data?: any) {

        const headers = Tak.headers

        if(data instanceof Set) return Response.json(Array.from(data), { status, headers }) 
        
        if(data instanceof Map) return Response.json(Object.fromEntries(data), { status, headers })

        if(data instanceof FormData || data instanceof Blob) return new Response(data, { status, headers })

        if(typeof data === "object" && !Array.isArray(data) && !this.isAsyncIterator(data) && !this.hasFunctions(data)) return Response.json(data, { status, headers })

        if((typeof data === "object" && Array.isArray(data)) || data instanceof Array) return Response.json(data, { status, headers })

        if(typeof data === "number" || typeof data === "boolean") return Response.json(data, { status, headers })
    
        return new Response(data, { status, headers })
    }

    private static getLogWriter(path: string, method: string) {

        let logWriter: FileSink | undefined;

        if(Tak.logDestination) {
            const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')
            const dir = `${Tak.logDestination}/${date}/${path}/${method}`
            const file = Bun.file(`${dir}/${crypto.randomUUID()}.txt`)
            logWriter = file.writer()
        }

        return logWriter
    }

    private static async logError(e: Error, url: URL, method: string, logWriter?: FileSink, startTime?: number) {

        const path = url.pathname

        const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')

        const dir = `${Tak.heapDestination}/${date}/${path}/${method}`

        const heapDestination = `${dir}/${crypto.randomUUID()}.json`

        if(logWriter) logWriter.end()

        if(Tak.heapDestination) await Bun.write(heapDestination, JSON.stringify(generateHeapSnapshot(), null, 2))

        console.error(`"${method} ${path}" ${e.cause as number ?? 500} ${startTime ? `- ${Date.now() - startTime}ms` : ''} - ${e.message.length} byte(s)`)
    }

    static async serve() {

        await Tak.validateRoutes()

        Tak.configLogger()

        const server = Bun.serve({ async fetch(req: Request) {

            const ipAddress: string = server.requestIP(req)!.address

            const url = new URL(req.url)

            if(req.headers.get('Connection') === Tak.UPGRADE && req.headers.get(Tak.UPGRADE) === 'websocket') {
                    
                if(!server.upgrade<_WSContext>(req, { data: { request: req, ipAddress }})) throw new Error('WebSocket upgrade error', { cause: 500 })

                console.log('Upgraded to WebSocket!')
                
                return undefined
            }
            
            const startTime = Date.now()

            const logWriter = Tak.getLogWriter(url.pathname, req.method)

            return await Tak.Context.run({ request: req, requestTime: startTime, ipAddress, logWriter, slugs: Tak.getSlugs(req) }, async () => {
                
                let res: Response;
                
                try {

                    const data = await Tak.processRequest()
        
                    res = Tak.processResponse(200, data)

                    if(logWriter) logWriter.end()
                
                    if(!Tak.isAsyncIterator(data)) console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} byte(s)`)

                } catch(e: any) {

                    await Tak.logError(e, url, req.method, logWriter, startTime)

                    res = Response.json({ detail: e.message }, { status: e.cause as number ?? 500, headers: Tak.headers })
                }
                
                return res
            })
        
        }, websocket: {

            open(ws) {
                const { request } = ws.data as _WSContext
                const url = new URL(request.url)
                ws.send(`Connected ${url.pathname}`)
            }, 
            async message(ws, message: string) {

                const { ipAddress, request } = ws.data as _WSContext

                const req = new Request(request.url, JSON.parse(message))

                if(req.method === null) throw new Error('Method not provided for WebSocket Connection', { cause: 404 })
                
                const logWriter = Tak.getLogWriter(new URL(req.url).pathname, req.method)

                await Tak.Context.run({ request: req, subscribe: ws.subscribe, ipAddress, publish: server.publish, slugs: Tak.getSlugs(req) }, async () => {

                    try {

                        await Tak.processRequest()

                    } catch(e: any) {

                        await Tak.logError(e, new URL(req.url), req.method, logWriter)

                        ws.close(e.cause as number ?? 500, e.message)
                    }
                })
            },
            close(ws, code, reason) {
                const { request } = ws.data as _WSContext
                console.warn(`Disconnected from ${new URL(request.url).pathname} - Code: ${code} - Reason: ${reason}`)
            }

        }, error(req) {
        
            console.error(req.message)
        
        }, port: process.env.PORT || 8000 })

        process.on('SIGINT', () => process.exit(0))

        console.info(`Live Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit)`)
    }

    static async validateRoutes() {

        const files = (await Array.fromAsync(new Glob(`**/*.{ts,js}`).scan({ cwd: './routes' })))

        Tak.hasMiddleware = files.some((file) => file.includes('_middleware'))

        const routes = files.filter((route) => !route.split('/').some((path) => path.startsWith('_')))

        const staticPaths: string[] = []
    
        for(const route of routes) {
    
            const paths = route.split('/')
    
            const pattern = /[<>|\[\]]/

            const slugs = new Map<string, number>()

            paths.forEach((path, idx) => {

                if(pattern.test(path) && (idx % 2 === 0 || paths[idx].includes('.ts'))) {
                    throw new Error(`Invalid route ${route}`)
                }

                if(pattern.test(path)) slugs.set(path.replace('[', '').replace(']', ''), idx)
            })
    
            const idx = paths.findIndex((path) => pattern.test(path))
    
            if(idx > -1 && (idx % 2 === 0 || paths[idx].includes('.ts'))) throw new Error(`Invalid route ${route}`)
    
            const staticPath = paths.filter((path) => !pattern.test(path)).join(',')
    
            if(staticPaths.includes(staticPath)) throw new Error(`Duplicate route ${route}`)
    
            staticPaths.push(staticPath)

            const module = await import(`${process.cwd()}/routes/${route}`)

            const controller = (new module.default() as any).constructor

            const methodFuncs = new Map<string, Function>()

            for(const method of Tak.allMethods) {

                if(controller[method]) {

                    methodFuncs.set(method, controller[method])
                }
            }

            Tak.indexedRoutes.set(route, methodFuncs)
            if(slugs.size > 0) Tak.routeSlugs.set(route, slugs)
        }

        return Tak.indexedRoutes
    }

    private static parseParams(input: string[]) {

        const params: (string | boolean | number | null)[] = []

        for(const param of input) {

            const num = Number(param)

            if(!Number.isNaN(num)) params.push(num)

            else if(param === 'true') params.push(true)

            else if(param === 'false') params.push(false)

            else if(param === 'null') params.push(null)

            else params.push(param)
        }

        return params
    }

    private static parseKVParams(input: URLSearchParams | FormData) {

        const params: Record<string, any> = {}

        input.forEach((val, key) => {

            const num = Number(val)

            if(!Number.isNaN(num)) params[key] = num

            else if(val === 'true') params[key] = true

            else if(val === 'false') params[key] = false

            else if(typeof val === "string" && val.includes(',')) params[key] = this.parseParams(val.split(','))

            else if(val === 'null') params[key] = null

            if(params[key] === undefined) params[key] = val
        })

        return params
    }
}