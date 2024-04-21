import { AsyncLocalStorage } from "async_hooks";

declare global {
    interface _WSContext {
        url: URL,
        method: string | null
    }
    interface _HTTPContext {
        headers?: HeadersInit,
        url: URL,
        websocket: boolean
    }
    class Eon {
        static Depends(...dependants: Function[]): Function
        static Context: AsyncLocalStorage<_HTTPContext>
    }
}