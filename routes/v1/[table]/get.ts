import { _HTTPContext } from "../../../types"
import { TEST } from "../../_utils/find"

export default class {

    @TEST('admin')
    static async GET({ slugs }: _HTTPContext) {

        console.info(slugs)

        return slugs
    }
}