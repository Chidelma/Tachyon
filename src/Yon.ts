#!/usr/bin/env bun
import Tach from "./Tach.js"
import Silo from "@vyckr/byos";

try {

    const start = Date.now()

    const server = Bun.serve({ fetch: Tach.fetch, async error(req) {

        if(Tach.dbPath && Tach.saveStats) await Silo.putData(Tach.statsTableName, { cpu: process.cpuUsage(), memory: process.memoryUsage(), date: Date.now() })

        return Response.json({ detail: req.message }, { status: req.cause as number ?? 500, headers: Tach.headers })
    }, 
        development: Tach.inDevelopment,
        port: process.env.PORT || 8000 
    })

    process.on('SIGINT', () => process.exit(0))

    console.info(`Live Server is running on http://${server.hostname}:${server.port} (Press CTRL+C to quit) - StartUp Time: ${Date.now() - start}ms`)

} catch(e) {
    if(e instanceof Error) console.error(e.message)
}
