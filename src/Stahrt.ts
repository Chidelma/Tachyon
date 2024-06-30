#!/usr/bin/env node
import Tak from "./Eon"

try {
    await Tak.serve()
} catch(e) {
    if(e instanceof Error) console.error(e.message)
}
