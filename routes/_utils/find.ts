import Tak from "../../Eon"

export const TEST = (role: string) => () => {
    console.log(role)
    console.log(Tak.Context.getStore())
}