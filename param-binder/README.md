# param-binder

显式 `@param` 说明绑定器：把**调用方提供的签名模型**与**调用方提供的 DocComment 模型**
做显式路径匹配。它只处理这两个输入模型——

- 不猜测任何参数名（解构路径必须显式写出，如 `options.x`）；
- 不执行被文档化的函数；
- 不求值默认表达式（默认表达式只作为原始文本展示）；
- 不读取类型 checker 或完整项目；
- 源码路径映射（`loc: {file, line, column}`）从输入原样保留到报告。

## 运行（Node 命令）

无需安装任何依赖，Node 18+ 即可（开发使用 Node 24 验证）：

```bash
# 单元测试（node:test，内置测试运行器）
node --test param-binder/test/binder.test.js

# 签名例子 1：干净绑定（a、options.x、options.y 各自绑定）
node param-binder/src/cli.js param-binder/examples/signature1.json param-binder/examples/doc1.json

# 签名例子 2：展示 缺说明 / 多余说明 / 重复路径 / 未知解构路径
node param-binder/src/cli.js param-binder/examples/signature2.json param-binder/examples/doc2.json
```

CLI 退出码：存在 `missing` / `extra` / `duplicate` 错误时为 1；`unknown` 仅为警告，不影响退出码。

## 输入模型

### 签名模型（signature model）

```json
{
  "functionName": "render",
  "source": { "file": "src/render.ts", "line": 10, "column": 1 },
  "params": [
    { "name": "a", "optional": false, "loc": { "file": "src/render.ts", "line": 10, "column": 17 } },
    {
      "name": "options",
      "destructured": true,
      "loc": { "file": "src/render.ts", "line": 10, "column": 23 },
      "children": [
        { "name": "x", "loc": { "file": "src/render.ts", "line": 10, "column": 25 } },
        { "name": "y", "optional": true, "default": "\"north\" + getDefault()",
          "loc": { "file": "src/render.ts", "line": 10, "column": 28 } }
      ]
    }
  ]
}
```

- `children` 为数组：显式提供的解构子路径模型（如 `options.x`）。
- `children` 为 `null`：参数确为解构，但**未提供**子路径模型——其下的文档路径标记为
  `unknown`，绑定器拒绝猜测子名字。
- `default`：默认表达式的**原始源码文本**，只展示、绝不求值。
- `optional: true` 的参数**仍然必须**有文档说明（可选 ≠ 可缺说明）。

### DocComment 模型

```json
{
  "params": [
    { "path": "a", "text": "The first value.", "loc": { "file": "src/render.ts", "line": 6, "column": 5 } },
    { "path": "options.x", "text": "Horizontal position.", "loc": { "file": "src/render.ts", "line": 7, "column": 5 } }
  ]
}
```

## 问题类别

| kind        | 含义 | 是否错误 |
|-------------|------|----------|
| `missing`   | 模型中的叶子参数路径缺少 `@param` 说明（可选参数不豁免） | 错误 |
| `extra`     | 文档路径在提供的模型中无任何可绑定目标（多余说明），如模型只有 `options.x` 却写了 `options.y` | 错误 |
| `duplicate` | 同一路径被说明多次，报告中同时给出**两处**源码位置 | 错误 |
| `unknown`   | 路径穿过一个 `children: null` 的解构参数，子模型未提供，无法验证 | 警告 |

## 两个签名例子

- `examples/signature1.json` + `examples/doc1.json`：`render(a, { x, y })`，
  `a`、`options.x`、`options.y` 分别绑定，`options.y` 的默认表达式原样展示。
- `examples/signature2.json` + `examples/doc2.json`：`configure(a, level, { x }, ...flags)`，
  演示：重复 `a`（报 14:5 与 15:5 两位置）、多余 `options.y`、未知 `flags.verbose`
  （`flags` 解构但未提供子模型）、可选参数 `level` 缺说明（默认表达式 `"1 + 1"` 不求值）。
