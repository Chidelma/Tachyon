#!/usr/bin/env node

import Eon from './Eon'
import Logger from './Lawger'

try {
    await Eon.serve()
} catch(e) {
    if(e instanceof Error) Logger.ERROR(e.message)
}
