import { FileSink } from "bun"

interface _WSContext {
    request: Request
    ipAddress: string
}

interface _HTTPContext {
    request: Request
    subscribe?: (topic: string) => void
    publish: (topic: string, data: string | ArrayBuffer | SharedArrayBuffer | import("bun").ArrayBufferView, compress?: boolean) => number
    requestTime?: number,
    ipAddress: string,
    logWriter?: FileSink,
    slugs: Map<string, any>
}