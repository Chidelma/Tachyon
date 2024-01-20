import { Glob } from "bun";
import Logger from "./Lawger"
import { watch } from 'fs';

export default class Eon {

    private static indexedRoutes: Map<string, Function> = new Map()

    private static hasMiddleware = false

    private static findRoute(route: string) {

        let handler = undefined

        const paths = route.split('/')

        for(const route of Eon.indexedRoutes.keys()) {

            if(route.startsWith(paths[0]) && (route.endsWith(`${paths[paths.length - 1]}.ts`) || route.endsWith(`${paths[paths.length - 1]}/index.ts`))) {
                handler = Eon.indexedRoutes.get(route)
                break
            }
        }

        if(handler === undefined) throw new Error(`Route ${route} not found`, { cause: 404 })

        return handler
    }

    static async serve() {

        await Eon.validateRoutes()

        const server = Bun.serve({async fetch(req: Request) {

            const url = new URL(req.url)
        
            const [route, params] = url.pathname.split(':')
        
            const handler = Eon.findRoute(route)
        
            const contentType = req.headers.get('Content-Type')
        
            let data = undefined
        
            const startTime = Date.now()
        
            if(contentType) {

                if(Eon.hasMiddleware) {

                    const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default
    
                    return await middleware(req, handler, [await Eon.transformRequest(req, contentType), req.headers])
                }
            
                data = await handler(await Eon.transformRequest(req, contentType), req.headers)
        
            } else if(params) {

                if(Eon.hasMiddleware) {

                    const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default
    
                    return await middleware(req, handler, [...Eon.parseParams(params.split('/')), req.headers])
                }
        
                data = await handler(...Eon.parseParams(params.split('/')), req.headers)
        
            } else {

                if(Eon.hasMiddleware) {

                    const middleware = (await import(`${process.cwd()}/routes/_middleware.ts`)).default
    
                    return await middleware(req, handler, [req.headers])
                }

                data = await handler(req.headers)
            }
        
            Logger.INFO(`http://${url.hostname}:${url.port} - "${req.method} ${url.pathname}" 200 OK - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} bytes`)
            
            return typeof data === 'object' ? Response.json(data, { status: 200 }) : new Response(data, { status: 200 })
        
        }, error(req) {
        
            Logger.ERROR(`http://127.0.0.1:${process.env.PORT || 8000} - ${ req.cause ?? 500 } - ${req.message.length} bytes`)
        
            return Response.json({ detail: req.message }, { status: req.cause as number ?? 500 })
        
        }, port: process.env.PORT || 8000 })

        Logger.INFO(`Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit)`)

        const watcher = watch(`${process.cwd()}/routes`, (event, filename) => {
            server.reload({ fetch: server.fetch })
        })

        process.on('SIGINT', () => {
            watcher.close()
            process.exit(0)
        })
    }

    private static async validateRoutes() {

        const files = (await Array.fromAsync(new Glob(`**/*.ts`).scan({ cwd: './routes' })))

        Eon.hasMiddleware = files.some((file) => file.includes('_middleware.ts'))

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

            const handler = controller['handler']

            if(handler === undefined) throw new Error(`Handler for ${route} does not exist`)

            Eon.indexedRoutes.set(route, handler)
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