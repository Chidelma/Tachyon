import { _HTTPContext } from "../../../../types/index.js";
import { VALIDATE } from "../../../_utils/validation.js";

export default class {

    @VALIDATE([{ type: "object" }])
    static GET({ request }: _HTTPContext) {

        return {

            async *[Symbol.asyncIterator]() {

                yield request.url
            }
        }
    }

    @VALIDATE([{ type: "object", default: {} }, { type: "object" }])
    static DELETE({ request }: _HTTPContext) {

        return {

            async *[Symbol.asyncIterator]() {

                yield request.url
            }
        }
    }
}