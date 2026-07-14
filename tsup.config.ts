import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react/index.ts',
    'adapters/index': 'src/adapters/index.ts',
    'adapters/designkit': 'src/adapters/designkit/index.ts',
    'adapters/gridkit': 'src/adapters/gridkit/index.ts',
    'adapters/chartkit': 'src/adapters/chartkit/index.ts',
    'adapters/basekit': 'src/adapters/basekit/index.ts',
    'adapters/datasourcekit': 'src/adapters/datasourcekit/index.ts',
  },
  format:    ['esm', 'cjs'],
  dts:       true,
  sourcemap: true,
  clean:     true,
  external:  ['react', 'react-dom', '@loykin/designkit', '@loykin/gridkit', '@loykin/chartkit', '@loykin/filter-input', '@loykin/datasourcekit'],
  treeshake: true,
})
