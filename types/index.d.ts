interface _log {
    date: number
    msg: string
    type: "info" | "error" | "debug" | "warn" | "trace"
}

interface _HTTPContext {
    request: Request
    requestTime: number,
    ipAddress: string,
    logs: _log[],
    slugs: Map<string, any>
}