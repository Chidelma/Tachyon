import { AsyncLocalStorage } from "async_hooks";

export interface _WSContext {
    request: Request
    method: string | null,
    ipAddress: string
}

export interface _AccessControl {
    allowedMethods: string[],
    allowedHeaders: string[],
    allowCredentials: boolean,
    allowedOrigins: string[]
}

export interface _HTTPContext {
    request: Request,
    websocket: boolean,
    requestTime?: number,
    accessControl?: _AccessControl
    ipAddress: string,
    logs: string[]
}