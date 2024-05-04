#!/usr/bin/env node
import Tak from "./Eon"

try {
    new Tak()
} catch(e) {
    if(e instanceof Error) console.error(e.message)
}
