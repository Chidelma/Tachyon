import Tak from "../../../src/Eon"
import { TEST } from "../../_utils/find"

export default class {

    @TEST('admin')
    static async GET() {

        const { slugs } = Tak.Context.getStore()!

        console.info(slugs)

        return {
            hello: 'world'
        }
    }
}