import { _HTTPContext } from "../../../types"

export default class Schema {

    static async POST({ request }: _HTTPContext) {

        console.log(request.url)
    }

    static async PATCH({ request }: _HTTPContext) {

        console.log(request.url)
    }

    static DELETE({ request }: _HTTPContext) {

        console.log(request.url)
    }
}