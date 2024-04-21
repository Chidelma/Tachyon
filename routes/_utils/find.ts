export const TEST = (role: string) => () => {
    console.log(role)
    console.log(Eon.Context.getStore())
}