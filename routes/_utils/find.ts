export const TEST = (role: string) => (cls: Object, funcName: string, propDesc: PropertyDescriptor) => {

    const originalFunc: Function = propDesc.value
            
    propDesc.value = async function(...args: any[]) {

        console.info(role)

        return originalFunc.apply(this, args)
    }
    
}