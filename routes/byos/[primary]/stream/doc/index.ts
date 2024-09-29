import { VALIDATE } from "../../../../utils/validation.js";

export default class {

    @VALIDATE([{ type: "object" }])
    static GET({ request }: _HTTPContext) {

        return {

            async *[Symbol.asyncIterator]() {

                yield request.url
            }
        }
    }

    @VALIDATE([{ type: "object" }])
    static DELETE({ request }: _HTTPContext) {

        return {

            async *[Symbol.asyncIterator]() {

                yield request.url
            }
        }
    }
}