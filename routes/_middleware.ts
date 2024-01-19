export default async function _middleware(req: Request, handler: Function, context: any[]) {

    const data = await handler(...context)

    return new Response(data, { status: 200 })
}