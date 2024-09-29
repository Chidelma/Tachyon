import { VALIDATE } from "../../../utils/validation.js";

export default class Docs {

    @VALIDATE([{ type: "object" }])
    static async GET({ request }: _HTTPContext) {

        console.log(request.url)
    }

    @VALIDATE([{ type: "object" }])
    static async POST({ request }: _HTTPContext) {

        console.log(request.url)
    }

    @VALIDATE([{ type: "object" }])
    static async PATCH({ request }: _HTTPContext) {

        console.log(request.url)
    }

    @VALIDATE([{ type: "object" }])
    static async DELETE({ request }: _HTTPContext) {

        console.log(request.url)
    }
}