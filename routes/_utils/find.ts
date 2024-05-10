import Tak from "../../Eon"

export const TEST = (role: string) => (cls: Object, funcName: string, propDesc: PropertyDescriptor) => {

    const originalFunc: Function = propDesc.value
            
    propDesc.value = async function(...args: any[]) {

        console.log(role)
        
        console.log(Tak.Context.getStore())

        return originalFunc.apply(this, args)
    }
    
}