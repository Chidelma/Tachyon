import { VALIDATE } from "../../../../../utils/validation.js";

export default class Docs {

    @VALIDATE([{ type: "object" }])
    static async GET({ slugs }: _HTTPContext) {

        console.info(slugs)
    }
}