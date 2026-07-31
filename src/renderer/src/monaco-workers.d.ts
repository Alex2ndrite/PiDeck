/**
 * Monaco TS Worker 的类型声明。该模块在构建时被 Vite 插件
 *（electron.vite.config.ts:monacoTsWorkerPlugin）替换为空的 TsWorker 桩，
 * 因此运行时不加载完整的 TypeScript 编译器。
 *
 * 放在独立的 .d.ts 中（无 import/export），作为全局脚本声明，
 * 避免被 types.d.ts 中的 export {} 影响模块解析。
 */
declare module "monaco-editor/esm/vs/language/typescript/ts.worker" {
	const TsWorker: { new (): Worker };
	export default TsWorker;
}
