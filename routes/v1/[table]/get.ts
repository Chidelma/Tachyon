import { TEST } from "../../_utils/find"

export default class {

    @Eon.Depends(TEST('admin'))
    static GET() {

        return {
            hello: 'world'
        }
    }
}