import { FileSink, ServerWebSocket } from "bun"

export interface _WSContext {
    request: Request
    ipAddress: string
}

export interface _AccessControl {
    allowedMethods: string[],
    allowedHeaders: string[],
    allowCredentials: boolean,
    allowedOrigins: string[]
}

export interface _HTTPContext {
    request: Request
    ws?: ServerWebSocket<unknown>,
    requestTime?: number,
    accessControl?: _AccessControl
    ipAddress: string,
    logWriter?: FileSink
}

interface _logging {
    save: boolean,
    path: string
}

interface _heap {
    save: boolean
    path: string
}

export interface _config {
    logging?: _logging,
    heap?: _heap,
    enableMemDB?: boolean
}