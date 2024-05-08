import { FileSink, Glob } from "bun";
import pino from "pino";
import { AsyncLocalStorage } from "async_hooks";
import { startRxStorageRemoteWebsocketServer } from "rxdb/plugins/storage-remote-websocket"
import { getRxStorageMemory } from 'rxdb/plugins/storage-memory'
import { _AccessControl, _WSContext, _HTTPContext, _config } from "./types/global";
import { generateHeapSnapshot } from "bun"
import { existsSync, mkdirSync } from 'node:fs'

export default class Tak {

    private static indexedRoutes = new Map<string, Map<string, Function>>()

    private static allowedMethods = ['GET', 'POST', 'PUT', 'HEAD', 'DELETE', 'PATCH', 'OPTIONS']

    private static allowedOrigins = []

    private static allowedHeaders = []

    private static allowCredentials = true

    private static hasMiddleware = false

    private static saveLogs = false

    private static logDestination = ''

    private static saveHeaps = false

    private static heapDestination = ''

    private static readonly UPGRADE = 'Upgrade'

    private static readonly WSProtocol = 'Sec-WebSocket-Protocol'

    private static enableMemoryServer = false

    static Context = new AsyncLocalStorage<_HTTPContext>()

    constructor() {
        Tak.serve()
    }

    static Depends(...dependants: Function[]) {

        return function(cls: Object, funcName: string, propDesc: PropertyDescriptor) {

            const originalFunc: Function = propDesc.value
    
            const depends = async () => { for(const func of dependants) await func() }
            
            propDesc.value = async function(...args: any[]) {
    
                await depends()

                const { websocket } = Tak.Context.getStore()!
        
                if(!websocket) return originalFunc.apply(this, args)
            }
    
            propDesc.value.prototype = {
                ...originalFunc.prototype,
                depends
            }
        }
    }

    private static getHandler() {

        const { request } = Tak.Context.getStore()!

        const url = new URL(request.url)

        let handler = undefined

        const paths = url.pathname.split('/')

        const lastIdx = paths.length - 1

        for(const [routeKey, routeMap] of Tak.indexedRoutes) {

            if(routeKey.startsWith(paths[0]) && (routeKey.endsWith(`${paths[lastIdx]}.ts`) || routeKey.endsWith(`${paths[lastIdx]}/index.ts`))) {

                handler = routeMap.get(request.method)
                
                break
            }
        }

        if(handler === undefined) throw new Error(`Route ${url.pathname} not found`, { cause: 404 })

        return { handler, params: url.search.replace('?', '').split('/') }
    }

    private static async serveStaticFile() {

        const { request } = Tak.Context.getStore()!

        const url = new URL(request.url)

        const file = Bun.file(`${process.cwd()}/public/${url.pathname}`)

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

        console.log = (msg) => {
            Logger.info(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [INFO] ${msg}\n`)
            }
        }
        console.info = (msg) => {
            Logger.info(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [INFO] ${msg}\n`)
            }
        }
        console.error = (msg) => {
            Logger.error(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [ERROR] ${msg}\n`)
            }
        }
        console.debug = (msg) => {
            Logger.debug(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [DEBUG] ${msg}\n`)
            }
        }
        console.warn = (msg) => {
            Logger.warn(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [WARN] ${msg}\n`)
            }
        }
        console.trace = (msg) => {
            Logger.trace(msg)
            if(Tak.Context.getStore()) {
                const { logWriter } = Tak.Context.getStore()!
                if(logWriter) logWriter.write(`[${new Date().toISOString()}] [TRACE] ${msg}\n`)
            }
        }
    }

    private static async processRequest() {

        const { request } = Tak.Context.getStore()!

        const { handler, params } = Tak.getHandler()
    
        let data = undefined

        const contentType = request.headers.get('ContentType')
    
        if(contentType) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(async () => handler(await Tak.transformRequest()))
            }

            data = await handler(await Tak.transformRequest())
    
        } else if(params.length > 0) {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(() => handler(...Tak.parseParams(params)))
            }

            data = await handler(...Tak.parseParams(params)) 
    
        } else {

            if(Tak.hasMiddleware) {

                const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default

                return await middleware(() => handler())
            }

            data = await handler()
        }

        return data
    }

    private static connect() {

        const port = process.env.LIVE_PORT || 8080

        startRxStorageRemoteWebsocketServer({
            port,
            database: getRxStorageMemory()
        })

        console.info(`RxDB Server is running on ws://localhost:${port} (Press CTRL+C to quit)`)
    }

    private static async serve() {

        await Tak.readConfiguration()

        await Tak.validateRoutes()

        Tak.configLogger()

        if(Tak.enableMemoryServer) Tak.connect()

        const server = Bun.serve({ async fetch(req: Request) {

            const ipAddress: string = server.requestIP(req)!.address

            const url = new URL(req.url)

            if(req.headers.get('Connection') === Tak.UPGRADE && req.headers.get(Tak.UPGRADE) === 'websocket') {

                const method = req.headers.get(Tak.WSProtocol)
                    
                if(!server.upgrade<_WSContext>(req, { data: { method, request: req, ipAddress }})) throw new Error('WebSocket upgrade error', { cause: 500 })

                console.log('Upgraded to WebSocket!')
                
                return undefined
            }
            
            const startTime = Date.now()

            const accessControl: _AccessControl = {
                allowCredentials: Tak.allowCredentials,
                allowedHeaders: Tak.allowedHeaders,
                allowedMethods: Tak.allowedMethods,
                allowedOrigins: Tak.allowedOrigins
            }

            let logWriter: FileSink | undefined;

            if(Tak.saveLogs) {
                const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')
                const dir = `${Tak.logDestination}/${url.pathname}/${req.method}/${date}`
                if(!existsSync(dir)) mkdirSync(dir, { recursive: true })
                const file = Bun.file(`${dir}/${crypto.randomUUID()}.txt`)
                logWriter = file.writer()
            }

            return await Tak.Context.run({ websocket: false, request: req, requestTime: startTime, accessControl, ipAddress, logWriter }, async () => {
                
                let res: Response;
                
                try {

                    const pattern = /\.(jpg|jpeg|png|gif|bmp|ico|svg|webp|css|scss|sass|less|js|json|xml|html|woff|woff2|ttf|eot)$/i
    
                    if(pattern.test(url.pathname)) {
                        
                        const file = await Tak.serveStaticFile()
        
                        res = new Response(file, { status: 200 })
        
                        console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${file.size} byte(s)`)
                    
                        return res
                    }
                    
                    const data = await Tak.processRequest()

                    const channel = req.headers.get('channel')

                    const publish = (msg: string) => server.publish(channel!, msg)
        
                    if(typeof data === 'object') {
                        res = Response.json(data, { status: 200 })
                        if(channel) publish(JSON.stringify(data))
                    } else {
                        res = new Response(data, { status: 200 })
                        if(channel) publish(data)
                    }

                    if(logWriter) logWriter.end()
                
                    console.info(`"${req.method} ${url.pathname}" ${res.status} - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} byte(s)`)

                } catch(e: any) {

                    const path = url.pathname

                    const date = new Date().toISOString().split('T')[0].replaceAll('-', '/')

                    const dir = `${Tak.heapDestination}/${path}/${req.method}/${date}`

                    if(!existsSync(dir)) mkdirSync(dir, { recursive: true })

                    const heapDestination = `${dir}/${crypto.randomUUID()}.json`

                    if(logWriter) logWriter.end()

                    if(Tak.saveHeaps) await Bun.write(heapDestination, JSON.stringify(generateHeapSnapshot(), null, 2))

                    console.error(`"${req.method} ${path}" ${e.cause as number ?? 500} - ${Date.now() - startTime}ms - ${e.message.length} byte(s)`)

                    res = Response.json({ detail: e.message }, { status: e.cause as number ?? 500 })
                }
                
                return res
            })
        
        }, websocket: {

            open(ws) {
                const { request, method } = ws.data as _WSContext
                const url = new URL(request.url)
                ws.send(`Successfully connected ${url.pathname} - ${method}`)
            }, 
            async message(ws, message: string) {

                const headers: Headers = JSON.parse(message)

                const { request, method, ipAddress } = ws.data as _WSContext

                if(method === null) throw new Error('Method not provided for WebSocket Connection', { cause: 404 })
                
                await Tak.Context.run({ request, websocket: true, ipAddress }, async () => { 
                    
                    const { handler } = Tak.getHandler()

                    if(handler.prototype && handler.prototype.depends) await handler.prototype.depends()
                })

                ws.subscribe(headers.get('channel')!)
            },
            close(ws, code, reason) {
                const { request, method } = ws.data as _WSContext
                const url = new URL(request.url)
                ws.send(`Successfully disconnected from ${url.pathname} - ${method}`)
            }

        }, error(req) {
        
            console.error(req.message)
        
        }, port: process.env.SERVER_PORT || 8000 })

        process.on('SIGINT', () => process.exit(0))

        console.info(`Live Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit)`)
    }

    private static async readConfiguration() {

        const config: _config = await Bun.file(`${process.cwd()}/config.json`).json()

        if(config.logging) {
            if(config.logging.save === undefined || config.logging.path === undefined) throw new Error("Please configuree logging")
            this.saveLogs = config.logging.save
            this.logDestination = config.logging.path
        }

        if(config.heap) {
            if(config.heap.save === undefined || config.heap.path === undefined) throw new Error("Please configuree heap")
            this.saveHeaps = config.heap.save
            this.heapDestination = config.heap.path
        }

        if(config.enableMemDB) Tak.enableMemoryServer = config.enableMemDB
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

            for(const method of Tak.allowedMethods) {

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

    private static async transformRequest() {

        const { request } = Tak.Context.getStore()!

        const contentType = request.headers.get('Content-Type')!

        if(contentType.includes('json')) return await request.json()
        
        if(contentType.includes('text')) return await request.text()
    
        if(contentType.includes('form')) return await request.formData()
    
        return await request.blob() 
    }
}