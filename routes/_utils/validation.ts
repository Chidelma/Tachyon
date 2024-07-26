export const VALIDATE = (input: any[]) => (cls: Object, funcName: string, propDesc: PropertyDescriptor) => {

    const originalFunc: Function = propDesc.value
            
    propDesc.value = async function(...args: any[]) {

        const params = [...input]

        if(params.length !== args.length) {

            do {

                const idx = params.findLastIndex(x => x.default !== undefined)

                if(idx === -1) break

                const [ param ] = params.splice(idx, 1)

                args.unshift(param.default)

            } while(true)

            if(input.length !== args.length) throw new Error(`Invalid number of arguments for ${funcName}`)
        }

        for(let i = 0; i < input.length; i++) {

            if(typeof args[i] !== input[i].type) {

                throw new Error(`Invalid argument type for ${funcName}`)
            }
        }

        return originalFunc.apply(this, args)
    }
}