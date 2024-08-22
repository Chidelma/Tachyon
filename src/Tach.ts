import { Glob, generateHeapSnapshot } from "bun";
import { AsyncLocalStorage } from "async_hooks";
import { existsSync } from "node:fs";
import Silo from "@delma/byos";
import { watch } from "node:fs";

export default class Yon {

    private static indexedRoutes = new Map<string, Map<string, Function>>()

    private static routeSlugs = new Map<string, Map<string, number>>()

    private static allMethods = process.env.ALLOW_METHODS ? process.env.ALLOW_METHODS.split(',') : ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

    private static hasMiddleware = existsSync(`${process.cwd()}/routes/_middleware.ts`)

    private static hashDestination = process.env.HASH_FILE_PATH 

    private static inDevelopment = process.env.DEVELOPMENT === 'true'

    private static headers: HeadersInit = {
        "Access-Control-Allow-Headers": process.env.ALLOW_HEADERS || "",
        "Access-Control-Allow-Origin": process.env.ALLLOW_ORGINS || "",
        "Access-Control-Allow-Credential": process.env.ALLOW_CREDENTIALS || "false",
        "Access-Control-Expose-Headers": process.env.ALLOW_EXPOSE_HEADERS || "",
        "Access-Control-Max-Age": process.env.ALLOW_MAX_AGE || ""
    }

    private static readonly dbPath = process.env.DATA_PREFIX

    private static readonly logsTableName = "_logs"
    private static readonly errorsTableName = "_errors"
    private static readonly requestTableName = "_requests"
    private static readonly statsTableName = "_stats"

    private static readonly saveLogs = process.env.SAVE_LOGS === 'true'
    private static readonly saveStats = process.env.SAVE_STATS === 'true'
    private static readonly saveRequests = process.env.SAVE_REQUESTS === 'true'
    private static readonly saveErrors = process.env.SAVE_ERRORS === 'true'

    private static Context = new AsyncLocalStorage<_log[]>()

    private static pathsMatch(routeSegs: string[], pathSegs: string[]) {

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
            const isMatch = this.pathsMatch(routeSegs, paths.slice(0, routeSegs.length));

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
                const logWriter = this.Context.getStore()
                if(logWriter && Yon.dbPath && Yon.saveLogs) logWriter.push({ date: Date.now(), msg: `${info.replace(reset, '').replace('\x1b[32m', '')}\n`, type: "info" }) // logWriter.write(`${info.replace(reset, '').replace('\x1b[32m', '')}\n`)
            }
        }

        console.error = (msg) => {
            const err = `[${this.formatDate()}]\x1b[31m ERROR${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(err)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter && Yon.dbPath && Yon.saveLogs) logWriter.push({ date: Date.now(), msg: `${err.replace(reset, '').replace('\x1b[31m', '')}\n`, type: "error" })
            }
        }

        console.debug = (msg) => {
            const bug = `[${this.formatDate()}]\x1b[36m DEBUG${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(bug)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter && Yon.dbPath && Yon.saveLogs) logWriter.push({ date: Date.now(), msg: `${bug.replace(reset, '').replace('\x1b[36m', '')}\n`, type: "debug" })
            }
        }

        console.warn = (msg) => {
            const warn = `[${this.formatDate()}]\x1b[33m WARN${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(warn)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter && Yon.dbPath && Yon.saveLogs) logWriter.push({ date: Date.now(), msg: `${warn.replace(reset, '').replace('\x1b[33m', '')}\n`, type: "warn" })
            }
        }

        console.trace = (msg) => {
            const trace = `[${this.formatDate()}]\x1b[35m TRACE${reset} (${process.pid}) ${this.formatMsg(msg)}`
            logger.log(trace)
            if(this.Context.getStore()) {
                const logWriter = this.Context.getStore()
                if(logWriter && Yon.dbPath && Yon.saveLogs) logWriter.push({ date: Date.now(), msg: `${trace.replace(reset, '').replace('\x1b[35m', '')}\n`, type: "trace" })
            }
        }
    }

    private static async logRequest(request: Request, status: number, context: _HTTPContext, data: any = null) {

        if(Yon.dbPath && Yon.saveRequests) {

            const url = new URL(request.url)
            const date = Date.now()
            const duration = date - (context.requestTime ?? 0)

            await Silo.putData(Yon.requestTableName, { ipAddress: context.ipAddress, url: `${url.pathname}${url.search}`, method: request.method, status, duration, date, size: data ? String(data).length : 0, data })
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

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(...params, context))
            
            } else res = await handler(...params, context)

            await this.logRequest(request, 200, context)

            return res

        } else if(params.length === 0 && queryParams && !data) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(queryParams, context))
            
            } else res = await handler(queryParams, context)

            await this.logRequest(request, 200, context)

            return res

        } else if(params.length === 0 && !queryParams && data) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(data, context))

            } else res = await handler(data, context)

            await this.logRequest(request, 200, context, await body.text())

            return res

        } else if(params.length > 0 && queryParams && !data) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(...params, queryParams, context))
            
            } else res = await handler(...params, queryParams, context)

            await this.logRequest(request, 200, context)

            return res
        
        } else if(params.length > 0 && !queryParams && data) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(...params, data, context))
            
            } else res = await handler(...params, data, context)

            await this.logRequest(request, 200, context, await body.text())

            return res

        } else if(params.length === 0 && data && queryParams) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(queryParams, data, context))
            
            } else res = await handler(queryParams, data, context)

            await this.logRequest(request, 200, context, await body.text())

            return res
        
        } else if(params.length > 0 && data && queryParams) {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(...params, queryParams, data, context))
            
            } else res = await handler(...params, queryParams, data, context)

            await this.logRequest(request, 200, context, await body.text())

            return res
        
        } else {

            let res = undefined

            if(this.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                res = await middleware(async () => handler(context))
            
            } else res = await handler(context)

            await this.logRequest(request, 200, context)

            return res
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

    private static async logError(e: Error, ipAddress: string, url: URL, method: string, logs: _log[], startTime?: number) {

        const path = url.pathname

        if(logs.length > 0) await Promise.all(logs.map(log => { 
                                return Silo.putData(Yon.logsTableName, { ipAddress, path, method, ...log })
                            }))

        if(Yon.dbPath && Yon.saveErrors) await Silo.putData(Yon.errorsTableName, { ...generateHeapSnapshot(), date: Date.now(), ipAddress, path, method, error: e.message })

        console.error(`"${method} ${path}" ${e.cause as number ?? 500} ${startTime ? `- ${Date.now() - startTime}ms` : ''} - ${e.message.length} byte(s)`)
    }

    private static watchFiles() {
        
        if(this.inDevelopment) {

            watch('./routes', { recursive: true }, async (ev, filename) => {
                delete import.meta.require.cache[`${process.cwd()}/routes/${filename}`]
                if(!filename?.split('/').some((path) => path.startsWith('_'))) await this.validateRoutes(filename!)
            })
        }
    }

    static async serve() {

        const start = Date.now()

        await this.validateRoutes()

        this.watchFiles()

        this.configLogger()

        let request: Request;

        let ipAddress: string;

        let logs: _log[] = [];

        let startTime: number;

        const server = Bun.serve({ async fetch(req: Request) {

            request = req.clone()

            logs = []

            ipAddress = server.requestIP(req)!.address

            const url = new URL(req.url)
            
            startTime = Date.now()

            return await Yon.Context.run(logs, async () => {

                let res: Response;
                
                const data = await Yon.processRequest(req, { request: req, requestTime: startTime, ipAddress, logs, slugs: new Map<string, any>() })
        
                res = Yon.processResponse(200, data)

                if(logs.length > 0) await Promise.all(logs.map(log => { 
                                        return Silo.putData(Yon.logsTableName, { ipAddress, path: url.pathname, method: req.method, ...log })
                                    }))
            
                if(!Yon.isAsyncIterator(data)) {

                    const status = res.status
                    const response_size = typeof data !== "undefined" ? String(data).length : 0
                    const url = new URL(req.url)
                    const method = req.method
                    const date = Date.now()
                    const duration = date - startTime
                    
                    console.info(`"${method} ${url.pathname}" ${status} - ${duration}ms - ${response_size} byte(s)`)
                
                    if(Yon.dbPath && Yon.saveStats) await Silo.putData(Yon.statsTableName, { cpu: process.cpuUsage(), memory: process.memoryUsage(), date: Date.now() })
                }
                
                return res
            })
        
        }, async error(req) {

            const url = new URL(request.url)
            const method = request.method

            await Yon.logError(req, ipAddress, url, method, logs, startTime)

            if(Yon.dbPath && Yon.saveStats) await Silo.putData(Yon.statsTableName, { cpu: process.cpuUsage(), memory: process.memoryUsage(), date: Date.now() })

            return Response.json({ detail: req.message }, { status: req.cause as number ?? 500, headers: Yon.headers })
        }, 
            development: this.inDevelopment,
            port: process.env.PORT || 8000 
        })

        process.on('SIGINT', () => process.exit(0))

        console.info(`Live Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit) - StartUp Time: ${Date.now() - start}ms`)
    }

    private static async validateRoutes(route?: string) {

        const staticPaths: string[] = []

        const validateRoute = async (route: string) => {  

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

        if(route) return await validateRoute(route)

        const files = Array.from(new Glob(`**/*.{ts,js}`).scanSync({ cwd: './routes' }))

        const routes = files.filter((route) => !route.split('/').some((path) => path.startsWith('_')))

        for(const route of routes) await validateRoute(route)

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