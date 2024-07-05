#!/usr/bin/env node
import Tach from "./Tach"

try {
    await Tach.serve()
} catch(e) {
    if(e instanceof Error) console.error(e.message)
}
