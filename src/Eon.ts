import { Glob, Server } from "bun";
import { watch } from 'fs';
import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";

export default class Tak {

    private static indexedRoutes = new Map<string, Map<string, Function>>()

    private static methods = ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS']

    private static hasMiddleware = false

    private static readonly UPGRADE = 'Upgrade'

    private static readonly WSProtocol = 'Sec-WebSocket-Protocol'

    constructor() {
        //@ts-ignore
        global.Eon = Tak
        //@ts-ignore
        globalThis.Eon.Depends = Tak.Depends
        //@ts-ignore
        globalThis.Eon.Context = new AsyncLocalStorage<_HTTPContext>()
        
        Tak.serve()
    }

    static Depends(...dependants: Function[]) {

        return function(cls: Object, funcName: string, propDesc: PropertyDescriptor) {

            const originalFunc: Function = propDesc.value
    
            const depends = async () => { for(const func of dependants) await func() }
            
            propDesc.value = async function(...args: any[]) {
    
                await depends()

                const { websocket } = Eon.Context.getStore()!
        
                if(!websocket) return originalFunc.apply(this, args)
            }
    
            propDesc.value.prototype = {
                ...originalFunc.prototype,
                depends
            }
        }
    }

    private static getHandler(url: URL, method: string) {

        let handler = undefined

        const paths = url.pathname.split('/')

        const lastIdx = paths.length - 1

        for(const [routeKey, routeMap] of Tak.indexedRoutes) {

            if(routeKey.startsWith(paths[0]) && (routeKey.endsWith(`${paths[lastIdx]}.ts`) || routeKey.endsWith(`${paths[lastIdx]}/index.ts`))) {

                handler = routeMap.get(method)
                
                break
            }
        }

        if(handler === undefined) throw new Error(`Route ${url.pathname} not found`, { cause: 404 })

        return { handler, params: url.search.replace('?', '').split('/') }
    }

    private static async serveStaticFile(path: string) {

        const file = Bun.file(`${process.cwd()}/public/${path}`)

        if(!await file.exists()) throw new Error(`File not found`, { cause: 404 })

        return file
    }

    private static configLogger() {

        const Logger = pino({
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true
                }
            }
        })

        console.log = (msg) => Logger.info(msg)
        console.info = (msg) => Logger.info(msg)
        console.error = (msg) => Logger.error(msg)
        console.debug = (msg) => Logger.debug(msg)
        console.warn = (msg) => Logger.warn(msg)
        console.trace = (msg) => Logger.trace(msg)
    }

    private static async processRequest(req: Request, url: URL, method: string, contentType: string | null) {

        const { handler, params } = Tak.getHandler(url, method)
    
        let data = undefined
    
        if(contentType) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(req, handler, [await Tak.transformRequest(req, contentType)])
            }

            data = await handler(await Tak.transformRequest(req, contentType))
    
        } else if(params.length > 0) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(req, handler, [...Tak.parseParams(params)])
            }

            data = await handler(...Tak.parseParams(params)) 
    
        } else {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(req, handler, [])
            }

            data = await handler()
        }

        return data
    }

    private static async serve() {

        await Tak.validateRoutes()

        Tak.configLogger()

        const server = Bun.serve({ async fetch(req: Request) {

            const url = new URL(req.url)

            if(req.headers.get('Connection') === Tak.UPGRADE && req.headers.get(Tak.UPGRADE) === 'websocket') {

                const method = req.headers.get(Tak.WSProtocol)
                    
                if(!server.upgrade<_WSContext>(req, { data: { url, method }})) throw new Error('WebSocket upgrade error', { cause: 500 })

                console.log('Upgraded to WebSocket!')
                
                return undefined
            }

            return await Eon.Context.run({ headers: req.headers, url, websocket: false }, async () => {
    
                const pattern = /\.(jpg|jpeg|png|gif|bmp|ico|svg|webp|css|scss|sass|less|js|json|xml|html|woff|woff2|ttf|eot)$/i
    
                const startTime = Date.now()
    
                if(pattern.test(url.pathname)) {
                    
                    const file = await Tak.serveStaticFile(url.pathname)
    
                    const res = new Response(file, { status: 200 })
    
                    console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${file.size} byte(s)`)
                
                    return res
                }

                const contentType = req.headers.get('Content-Type')
                
                const data = await Tak.processRequest(req, url, req.method, contentType)
    
                let res: Response;
    
                if(typeof data === 'object') {
                    res = Response.json(data, { status: 200 })
                    Tak.publish(server, req.headers, JSON.stringify(data))
                } else {
                    res = new Response(data, { status: 200 })
                    Tak.publish(server, req.headers, data)
                }
            
                console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} byte(s)`)
                
                return res
            })
        
        }, websocket: {

            open(ws) {
                const { url } = ws.data as _WSContext
                ws.send(`Successfully connected ${url.toString()}`)
            }, 
            async message(ws, message: string) {

                const headers: Headers = JSON.parse(message)

                const { url, method } = ws.data as _WSContext

                if(method === null) throw new Error('Method not provided for WebSocket Connection', { cause: 404 })
                
                await Eon.Context.run({ headers, url, websocket: true }, async () => { 
                    
                    const { handler } = Tak.getHandler(url, method)

                    if(handler.prototype && handler.prototype.depends) await handler.prototype.depends()
                })

                ws.subscribe(headers.get('channel')!)
            },
            close(ws, code, reason) {
                const { url } = ws.data as _WSContext
                ws.send(`Successfully disconnected from ${url.toString()}`)
            }

        }, error(req) {
        
            const res = Response.json({ detail: req.message }, { status: req.cause as number ?? 500 })

            console.error(`${res.status} - ${req.message.length} byte(s)`)

            return res
        
        }, port: process.env.PORT || 8000 })

        const watcher = watch(`${process.cwd()}/routes`, (event, filename) => {
            server.reload({ fetch: server.fetch })
        })

        process.on('SIGINT', () => {
            watcher.close()
            process.exit(0)
        })

        console.info(`Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit)`)
    }

    private static publish(server: Server, headers: Headers, msg: string) {
        server.publish(headers.get('channel')!, msg)
    }

    private static async validateRoutes() {

        const files = (await Array.fromAsync(new Glob(`**/*.{ts,js}`).scan({ cwd: './routes' })))

        Tak.hasMiddleware = files.some((file) => file.includes('_middleware'))

        const routes = files.filter((route) => !route.split('/').some((path) => path.startsWith('_')))

        const staticPaths: string[] = []
    
        for(const route of routes) {
    
            const paths = route.split('/')
    
            const pattern = /[<>|\[\]]/
    
            const idx = paths.findIndex((path) => pattern.test(path))
    
            if(idx > -1 && (idx % 2 === 0 || paths[idx].includes('.ts'))) throw new Error(`Invalid route ${route}`)
    
            const staticPath = paths.filter((path) => !pattern.test(path)).join(',')
    
            if(staticPaths.includes(staticPath)) throw new Error(`Duplicate route ${route}`)
    
            staticPaths.push(staticPath)

            const module = await import(`${process.cwd()}/routes/${route}`)

            const controller = (new module.default() as any).constructor

            const methodFuncs = new Map<string, Function>()

            for(const method of Tak.methods) {

                if(controller[method]) {

                    methodFuncs.set(method, controller[method])
                }
            }

            Tak.indexedRoutes.set(route, methodFuncs)
        }
    }

    private static parseParams(params: string[]) {

        const parsedParams: any[] = []
    
        for(const param of params) {
    
            const num = Number(param) 
    
            if(!Number.isNaN(num)) parsedParams.push(num)
    
            if(param === 'true') parsedParams.push(true)
    
            if(param === 'false') parsedParams.push(false)
    
            if(param !== 'null') parsedParams.push(param)
        }
    
        return parsedParams
    }

    private static async transformRequest(req: Request, contentType: string) {

        if(contentType.includes('json')) return await req.json()
        
        if(contentType.includes('text')) return await req.text()
    
        if(contentType.includes('form')) return await req.formData()
    
        return await req.blob() 
    }
}