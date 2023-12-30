export class Lawger {

    static INFO(...args: any[]) {
        const log = `INFO - ${args}`
        console.info(`${this.getDate()} - ${log}`)
    }

    static WARN(...args: any[]) {
        const log = `WARN - ${args}`
        console.info(`${this.getDate()} - ${log}`)
    }

    static ERROR(...args: any[]) {
        const log = `ERROR - ${args}`
        console.info(`${this.getDate()} - ${log}`)
    }

    private static getDate() {
        const date = new Date()

        const year = date.getUTCFullYear()
        const month = date.getUTCMonth() + 1
        const day = date.getUTCDate()

        const hour = date.getUTCHours()
        const minute = date.getUTCMinutes()
        const seconds = date.getUTCSeconds()
        const milliseconds = date.getUTCMilliseconds()

        return `${year}-${month}-${day} ${hour}:${minute}:${seconds}.${milliseconds}`
    }
}