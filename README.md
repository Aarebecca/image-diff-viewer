# Image Diff with PixelMatch

一个强大的 VS Code 插件，用于显示 Git 仓库中图片文件与上一个版本之间的差异。基于 `pixelmatch` 库实现像素级精确对比。

![](https://mdn.alipayobjects.com/huamei_zsgszn/afts/img/A*hm_tSohEvJQAAAAARgAAAAgAemV7AQ/original)

## 功能特性

### 三种对比模式

1. **并排显示模式** - 左右分别显示两个版本的图片，便于整体对比
2. **滑动对比模式** - 叠加显示两张图片，通过拖拽滑块调整分割区域
3. **差异显示模式** - 生成差异图片，高亮显示不同的像素

### 支持的图片格式

- PNG
- JPG/JPEG
- GIF
- BMP
- WebP

## 安装方法

1. 将项目克隆到本地
2. 打开终端，进入项目目录
3. 运行 `npm install` 安装依赖
4. 运行 `npm run compile` 编译 TypeScript
5. 按 `F5` 启动调试模式，或使用 `vsce package` 打包安装

## 使用方法

### 基本使用

1. 在 VS Code 中打开包含图片文件的 Git 仓库
2. 在资源管理器中右键点击任意图片文件
3. 选择 "Compare with Previous Version"
4. 插件会自动打开差异查看器

### 快捷键

- `Ctrl+Shift+P` (Windows/Linux) 或 `Cmd+Shift+P` (Mac) 打开命令面板
- 输入 "Image Diff" 查看相关命令

### 界面操作

#### 并排显示模式

- 左侧显示上一个版本的图片
- 右侧显示当前版本的图片
- 支持独立缩放和滚动

#### 滑动对比模式

- 两张图片叠加显示
- 拖拽中间的滑块调整分割线位置
- 实时预览不同区域的差异

#### 差异显示模式

- 显示由 pixelmatch 生成的差异图片
- 不同的像素会以红色高亮显示
- 支持调整差异检测的敏感度

## 技术实现

### 核心依赖

- **pixelmatch**: 用于像素级图片差异检测
- **pngjs**: 用于 PNG 图片的解析和处理
- **VS Code API**: 提供插件接口和 Git 集成

### 架构设计

```
extension.ts (主逻辑)
├── 命令注册和处理
├── Git 集成 (获取历史版本)
├── 图片处理 (pixelmatch)
└── WebView 界面生成

WebView (前端界面)
├── 三种显示模式的切换
├── 滑块拖拽交互
└── 响应式布局
```

### Git 集成

插件通过执行 `git show HEAD~1:filepath` 命令获取文件的上一个版本，支持：

- 获取指定提交的文件版本
- 处理文件重命名和移动
- 错误处理和用户提示

## 开发指南

### 项目结构

```
├── package.json          # 插件配置和依赖
├── tsconfig.json         # TypeScript 配置
├── src/
│   └── extension.ts      # 主要逻辑代码
└── README.md            # 说明文档
```

### 开发环境设置

1. 安装 Node.js (版本 16+)
2. 安装 VS Code
3. 安装 VS Code Extension 开发工具
4. 克隆项目并安装依赖

### 调试方法

1. 在 VS Code 中打开项目
2. 按 `F5` 启动插件调试
3. 在新窗口中测试插件功能
4. 使用开发者工具调试 WebView

### 构建和发布

```bash
# 编译 TypeScript
npm run compile

# 监听文件变化
npm run watch

# 打包插件
vsce package

# 发布到市场
vsce publish
```

## 自定义配置

你可以通过修改以下配置来自定义插件行为：

### pixelmatch 参数

在 `DiffImageGenerator` 中调整：

```typescript
const numDiffPixels = pixelmatch(
  currentImg.data,
  previousImg.data,
  diffImg.data,
  width,
  height,
  {
    threshold: 0.1, // 差异阈值 (0-1)
    includeAA: false, // 是否包含抗锯齿
    alpha: 0.1, // 透明度处理
    aaColor: [255, 255, 0], // 抗锯齿颜色
    diffColor: [255, 0, 0], // 差异高亮颜色
    diffColorAlt: null, // 备用差异颜色
  }
);
```

### Git 命令自定义

修改 `getPreviousVersion` 函数中的 Git 命令：

```typescript
// 比较与特定提交的差异
const gitCommand = `git show <commit-hash>:"${relativePath}"`;

// 比较与特定分支的差异
const gitCommand = `git show <branch-name>:"${relativePath}"`;
```

## 故障排除

### 常见问题

1. **无法获取上一版本**

   - 确保文件在 Git 仓库中
   - 检查文件是否有历史提交记录

2. **差异图片生成失败**

   - 检查图片格式是否支持
   - 确保两个版本的图片可以正常读取

3. **滑动模式不工作**
   - 检查浏览器是否支持 CSS clip-path
   - 确保 WebView 脚本正常加载

### 日志和调试

在开发者控制台中查看错误信息：

```javascript
// 在 WebView 中添加调试信息
console.log('Current mode:', currentMode);
console.log('Slider position:', percentage);
```

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 提交规范

- 使用清晰的提交信息
- 包含必要的测试
- 更新相关文档

### 开发流程

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 创建 Pull Request

## 许可证

MIT License - 详见 LICENSE 文件

## 更新日志

### v0.0.1 (2025-06-20)

- 初始版本发布
- 支持三种对比模式
- 集成 pixelmatch 差异检测
- Git 版本历史集成
