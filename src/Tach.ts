import { FileSink, Glob } from "bun";
import { AsyncLocalStorage } from "async_hooks";
import { generateHeapSnapshot } from "bun"
import { _HTTPContext, _WSContext } from "../types";
import { existsSync } from "fs";

export default class Yon {

    private static indexedRoutes = new Map<string, Map<string, Function>>()

    private static routeSlugs = new Map<string, Map<string, number>>()

    private static allMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

    private static hasMiddleware = existsSync(`${process.cwd()}/routes/_middleware.ts`)

    private static logDestination = process.env.LOG_PATH

    private static heapDestination = process.env.HEAP_PATH

    private static hashDestination = process.env.HASH_FILE_PATH

    private static headers: HeadersInit = {
        "Access-Control-Allow-Headers": process.env.ALLOW_HEADERS || "",
        "Access-Control-Allow-Origin": process.env.ALLLOW_ORGINS || "",
        "Access-Control-Allow-Credential": process.env.ALLOW_CREDENTIALS || "false",
        "Access-Control-Expose-Headers": process.env.ALLOW_EXPOSE_HEADERS || "",
        "Access-Control-Max-Age": process.env.ALLOW_MAX_AGE || ""
    }

    private static readonly UPGRADE = 'Upgrade'

    static Context = new AsyncLocalStorage<FileSink | undefined>()

    private static pathsMatch(request: Request, routeSegs: string[], pathSegs: string[]) {

        if (routeSegs.length !== pathSegs.length) {
            return false;
        }
    
        const slugs = this.routeSlugs.get(`${routeSegs.join('/')}.ts`) ?? new Map<string, number>()
    
        for (let i = 0; i < routeSegs.length; i++) {
            if (!slugs.has(routeSegs[i]) && routeSegs[i].replace('.ts', '') !== pathSegs[i]) {
                return false;
            }
        }
    
        return true;
    }

    private static getHandler(request: Request) {

        const url = new URL(request.url);

        let handler;
        let params: string[] = [];
        const paths = url.pathname.split('/').slice(1);
        const allowedMethods: string[] = [];

        let slugs = new Map<string, string>()

        let bestMatchKey = '';
        let bestMatchLength = -1;

        for (const [routeKey] of this.indexedRoutes) {
            const routeSegs = routeKey.split('/').map(seg => seg.replace('.ts', ''));
            const isMatch = this.pathsMatch(request, routeSegs, paths.slice(0, routeSegs.length));

            if (isMatch && routeSegs.length > bestMatchLength) {
                bestMatchKey = routeKey;
                bestMatchLength = routeSegs.length;
            }
        }

        if (bestMatchKey) {
            const routeMap = this.indexedRoutes.get(bestMatchKey)!
            handler = routeMap.get(request.method);

            for (const [key] of routeMap) {
                if (this.allMethods.includes(key)) allowedMethods.push(key);
            }

            params = paths.slice(bestMatchLength);

            const slugMap = this.routeSlugs.get(bestMatchKey) ?? new Map<string, number>()

            slugMap.forEach((idx, key) => slugs.set(key, paths[idx]))
        }

        this.headers = { ...this.headers, "Access-Control-Allow-Methods": allowedMethods.join(',') };

        if (!handler) throw new Error(`Route ${request.method} ${url.pathname} not found`, { cause: 404 });

        return { handler, params: this.parseParams(params), slugs }
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
            const info = `[${this.formatDate()}]\x1b[32m INFO${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(info)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()!
                if(logWriter) logWriter.write(`${info.replace(reset, '').replace('\x1b[32m', '')}\n`)
            }
        }

        console.error = (msg) => {
            const err = `[${this.formatDate()}]\x1b[31m ERROR${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(err)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter) logWriter.write(`${err.replace(reset, '').replace('\x1b[31m', '')}\n`)
            }
        }

        console.debug = (msg) => {
            const bug = `[${this.formatDate()}]\x1b[36m DEBUG${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(bug)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter) logWriter.write(`${bug.replace(reset, '').replace('\x1b[36m', '')}\n`)
            }
        }

        console.warn = (msg) => {
            const warn = `[${this.formatDate()}]\x1b[33m WARN${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(warn)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter) logWriter.write(`${warn.replace(reset, '').replace('\x1b[33m', '')}\n`)
            }
        }

        console.trace = (msg) => {
            const trace = `[${this.formatDate()}]\x1b[35m TRACE${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(trace)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter) logWriter.write(`${trace.replace(reset, '').replace('\x1b[35m', '')}\n`)
            }
        }
    }

    private static async processRequest(request: Request, context: _HTTPContext) {

        const { handler, params, slugs } = this.getHandler(request)

        if(slugs.size > 0) context.slugs = slugs

        const body = await request.blob()

        let data: Blob | Record<string, any> | undefined

        if(body.size > 0) {

            if(body.type.includes('form')) data = this.parseKVParams(await body.formData())
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

        if(searchParams.size > 0) queryParams = this.parseKVParams(searchParams)

        if(params.length > 0 && !queryParams && !data) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, context))
            }

            return await handler(...params, context)

        } else if(params.length === 0 && queryParams && !data) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(queryParams, context))
            }

            return await handler(queryParams, context)

        } else if(params.length === 0 && !queryParams && data) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(data, context))
            }

            return await handler(data, context)

        } else if(params.length > 0 && queryParams && !data) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, queryParams, context))
            }

            return await handler(...params, queryParams, context)
        
        } else if(params.length > 0 && !queryParams && data) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, data, context))
            }

            return await handler(...params, data, context)

        } else if(params.length === 0 && data && queryParams) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(queryParams, data, context))
            }

            return await handler(queryParams, data, context)
        
        } else if(params.length > 0 && data && queryParams) {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(...params, queryParams, data, context))
            }

            return await handler(...params, queryParams, data, context)
        
        } else {

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(context))
            }

            return await handler(context)
        }
    }

    private static isAsyncIterator(data: any) {
        return typeof data === "object" && Object.hasOwn(data, Symbol.asyncIterator)
    }

    private static hasFunctions(data: any) {
        return typeof data === "object" && (Object.keys(data).some((elem) => typeof elem === "function") || Object.values(data).some((elem) => typeof elem === "function"))
    }

    private static processResponse(status: number, data?: any) {

        const headers = this.headers

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

        if(this.logDestination) {
            const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')
            const dir = `${this.logDestination}/${date}/${path}/${method}`
            const file = Bun.file(`${dir}/${crypto.randomUUID()}.txt`)
            logWriter = file.writer()
        }

        return logWriter
    }

    private static async logError(e: Error, url: URL, method: string, logWriter?: FileSink, startTime?: number) {

        const path = url.pathname

        const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')

        const dir = `${this.heapDestination}/${date}/${path}/${method}`

        const heapDestination = `${dir}/${crypto.randomUUID()}.json`

        if(logWriter) logWriter.end()

        if(this.heapDestination) await Bun.write(heapDestination, JSON.stringify(generateHeapSnapshot(), null, 2))

        console.error(`"${method} ${path}" ${e.cause as number ?? 500} ${startTime ? `- ${Date.now() - startTime}ms` : ''} - ${e.message.length} byte(s)`)
    }

    static async serve() {

        await this.validateRoutes()

        this.configLogger()

        const server = Bun.serve({ async fetch(req: Request) {

            const ipAddress: string = server.requestIP(req)!.address

            const url = new URL(req.url)

            if(req.headers.get('Connection') === Yon.UPGRADE && req.headers.get(Yon.UPGRADE) === 'websocket') {
                    
                if(!server.upgrade<_WSContext>(req, { data: { request: req, ipAddress }})) throw new Error('WebSocket upgrade error', { cause: 500 })

                console.info('Upgraded to WebSocket!')
                
                return undefined
            }
            
            const startTime = Date.now()

            const logWriter = Yon.getLogWriter(url.pathname, req.method)

            return await Yon.Context.run(logWriter, async () => {

                let res: Response;
                
                try {

                    const data = await Yon.processRequest(req, { request: req, requestTime: startTime, ipAddress, publish: server.publish, logWriter })
        
                    res = Yon.processResponse(200, data)

                    if(logWriter) logWriter.end()
                
                    if(!Yon.isAsyncIterator(data)) console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} byte(s)`)

                } catch(e: any) {

                    await Yon.logError(e, url, req.method, logWriter, startTime)

                    res = Response.json({ detail: e.message }, { status: e.cause as number ?? 500, headers: Yon.headers })
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
                
                const logWriter = Yon.getLogWriter(new URL(req.url).pathname, req.method)

                return await Yon.Context.run(logWriter, async () => {

                    try {

                        await Yon.processRequest(req, { request: req, subscribe: ws.subscribe, ipAddress, publish: server.publish })
    
                    } catch(e: any) {
    
                        await Yon.logError(e, new URL(req.url), req.method, logWriter)
    
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

                if(pattern.test(path)) slugs.set(path, idx)
            })
    
            const idx = paths.findIndex((path) => pattern.test(path))
    
            if(idx > -1 && (idx % 2 === 0 || paths[idx].includes('.ts'))) throw new Error(`Invalid route ${route}`)
    
            const staticPath = paths.filter((path) => !pattern.test(path)).join(',')
    
            if(staticPaths.includes(staticPath)) throw new Error(`Duplicate route ${route}`)
    
            staticPaths.push(staticPath)

            const module = await import(`${process.cwd()}/routes/${route}`)

            const controller = (new module.default() as any).constructor

            const methodFuncs = new Map<string, Function>()

            for(const method of this.allMethods) {

                if(controller[method]) {

                    methodFuncs.set(method, controller[method])
                }
            }

            this.indexedRoutes.set(route, methodFuncs)

            if(slugs.size > 0) this.routeSlugs.set(route, slugs)
        }

        if(this.hashDestination) this.hashRoutes()
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

        for(const [key, val] of input) {

            if(typeof val === "string") {

                try {

                    params[key] = JSON.parse(val)
    
                } catch {
    
                    const num = Number(val)
    
                    if(!Number.isNaN(num)) params[key] = num
    
                    else if(val === 'true') params[key] = true
    
                    else if(val === 'false') params[key] = false
    
                    else if(typeof val === "string" && val.includes(',')) params[key] = this.parseParams(val.split(','))
    
                    else if(val === 'null') params[key] = null
    
                    if(params[key] === undefined) params[key] = val
                }

            } else params[key] = val
        }

        return params
    }
    
    private static async hashRoutes() {

        const hashedRoutes: Record<string, string> = {}

        for(const [route] of this.indexedRoutes) {
            
            const file = await Bun.file(`${process.cwd()}/routes/${route}`).text()

            hashedRoutes[route] = Bun.hash(file).toString()
        }

        await Bun.write(`${process.cwd()}/${this.hashDestination}`, JSON.stringify(hashedRoutes, null, 2))
    }
}