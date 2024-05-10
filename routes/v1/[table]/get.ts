import { TEST } from "../../_utils/find"

export default class {

    @TEST('admin')
    static GET() {

        return {
            hello: 'world'
        }
    }
}