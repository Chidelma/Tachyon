export default class {

    static POST(code: number, kilos: boolean, { name, age }: { name: string, age: number }) {
        
        console.info(code)
        console.debug(kilos)
        console.warn(name)
        console.trace(age)
        console.error("Error")

        return { code, kilos, name, age }
    }
}