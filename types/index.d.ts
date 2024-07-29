
interface _WSContext {
    request: Request
    ipAddress: string
}

interface _log {
    date: number
    msg: string
    type: "info" | "error" | "debug" | "warn" | "trace"
}

interface _HTTPContext {
    request: Request
    subscribe?: (topic: string) => void
    publish: (topic: string, data: string | ArrayBuffer | SharedArrayBuffer, compress?: boolean) => number
    requestTime?: number,
    ipAddress: string,
    logs: _log[],
    slugs: Map<string, any>
}