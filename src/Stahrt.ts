import { Lawger } from './Lawger';

function parsePaths(paths: string[]) {

    const parsedValues: any[] = []

    for(const val of paths) {

        const num = Number(val) 

        if(!Number.isNaN(num)) parsedValues.push(num)

        if(val === 'true') parsedValues.push(true)

        if(val === 'false') parsedValues.push(false)

        if(val !== 'null') parsedValues.push(val)
    }

    return parsedValues
}

async function transformRequest(req: Request, contentType: string) {

    if(contentType.includes('json')) return await req.json()
    
    if(contentType.includes('text')) return await req.text()

    if(contentType.includes('form')) return await req.formData()

    return await req.blob() 
}


const server = Bun.serve({async fetch(req: Request) {

    const url = new URL(req.url)

    const [file, func] = url.pathname.split('/').slice(1, 3)

    const handler = await import(`${process.cwd()}/src/${file}.ts`)

    const controller = (new handler() as any).constructor

    if(controller[func] === undefined) throw new Error(`${func} route does not exist in ${file} controller`, { cause: 501 })

    const route = controller[func]

    const contentType = req.headers.get('Content-Type')

    let data = undefined

    const paths = new URL(req.url).pathname.split('/').slice(3)

    const startTime = Date.now()

    if(contentType) {
    
        data = await route(await transformRequest(req, contentType), req.headers)

    } else if(paths.length > 0) {

        data = await route(...parsePaths(paths), req.headers)

    } else data = await route(req.headers)

    Lawger.INFO(`http://${url.host}:${url.port} - "${req.method} ${url.pathname} ${url.protocol}" 200 OK - ${Date.now() - startTime}ms - ${typeof data !== 'undefined' ? String(data).length : 0} bytes`)
    
    return typeof data === 'object' ? Response.json(data, { status: 200 }) : new Response(data, { status: 200 })

}, error(req) {

    Lawger.ERROR(`http://127.0.0.1:8000 - ${ req.cause ?? 500 } - ${req.message.length} bytes`)

    return Response.json({ detail: req.message }, { status: req.cause as number ?? 500 })

}})

Lawger.INFO(`Server is running on http://${server.hostname}:${server.port} (Press CLTRL+C to quit)`)