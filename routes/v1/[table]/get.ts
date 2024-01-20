export default class {

    static handler() {

        console.log(Bun.env.ROUTE)

        return {
            hello: 'world'
        }
    }
}