
import Tach from "./Tach.js"

try {
    await Tach.serve()
} catch(e) {
    if(e instanceof Error) console.error(e.message)
}
