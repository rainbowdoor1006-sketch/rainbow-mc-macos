# 待改动：PCL2 借鉴声明 + LLM 开发方式标注

> 这份文档只描述**要改什么、改成什么样**，不包含任何已有改动。
> 交给另一个对话执行即可。

---

## 一、要改哪两个地方

| 位置 | 改什么 |
|---|---|
| `docs/RAINBOW-MC-功能介绍与架构.md` | 新增两章（第十章、第十一章） |
| 网站「软件支持」页 RAINBOW MC 卡片 | 描述末尾加两行标注 |

**注意：只改这两处，不要动其他地方。**

---

## 二、文档新增：第十章 · 关于 PCL2 的借鉴

追加到 `docs/RAINBOW-MC-功能介绍与架构.md` 的第九章之后（页脚之前）。

**只写 3 项** —— 其余功能（整合包三种格式解析、启动阶段日志与崩溃分类、缺失补齐的幂等策略）是本项目自己踩坑后独立实现的，**不要写进借鉴清单**。

```markdown
## 十、关于 PCL2 的借鉴

RAINBOW MC 在核心机制上借鉴过 **PCL2（Plain Craft Launcher 2）** 的做法，
作者是 **龙腾猫跃**。

| PCL2 的做法 | 它解决什么问题 | RAINBOW MC 的实现 |
|---|---|---|
| **版本隔离** | 一个整合包的 mods 混进另一个版本，就是这个版本崩掉。隔离是「多项目共存」的前提 | `GameProject.isolated`；mods / saves / config 全在 `data/games/<项目>/` 内 |
| **组件库（共享 + 引用计数）** | 同一个模组被 3 个项目用，下载 3 次是浪费；直接删又会让别的项目崩 | `data/libraries/` + `library.json`，`usageProjects` 记录谁在用，删除时提示「还有 N 个项目在用」 |
| **自动选 Java** | 用户机器上基本没有合适的 JDK，版本不对就直接崩 | 四级回退：项目指定 → 全局指定 → 本机扫描 → 自动下载对应主版本 |

### 一句话

PCL2 把这些坑趟过一遍了。我们借鉴的是它趟出来的路，
工作量主要花在「按社团场景重新落一遍」，而不是「重新想一遍该怎么做」。

> 其余部分（整合包三种格式解析、启动阶段日志与崩溃分类、缺失补齐的幂等策略）
> 是本项目自己踩坑后独立实现的，不计入借鉴。
```

### 写作要求

- **不要写「重度依赖」「深度依赖」** —— 一律用「借鉴」
- **不要写设计风格相关的内容**（配色、页签布局、UI 风格都不算借鉴）
- 最后那句话（关于「其余部分独立实现」）**必须保留**，它界定了边界

---

## 三、文档新增：第十一章 · 关于开发方式

紧接在第十章之后。

```markdown
## 十一、关于开发方式

RAINBOW MC 的代码主要由 **LLM（大语言模型）** 编写，
社团成员负责提需求、验收、测试与发布。

| 环节 | 谁在做 |
|---|---|
| 需求定义、功能取舍 | 社团成员 |
| 代码实现、重构、调试 | LLM |
| 验收测试、真机跑游戏 | 社团成员 |
| 发布、版本管理 | 社团成员 |

### 需要说清楚的几点

```
· 代码里可能存在 LLM 常见的冗余写法，不够优雅的地方欢迎直接提 issue
· 安全相关逻辑（账号授权、令牌校验、路径穿越防护）经过人工逐段复核
· 崩溃诊断的分类规则来自真实崩溃日志，不是模型编的
· 这个项目不打算隐瞒开发方式
```

用 LLM 写代码不是什么需要遮掩的事，但也不该假装是手写的。
写在明面上，愿意用的人自然会用。
```

---

## 四、网站「软件支持」页的卡片

### 数据来源

描述存在数据库里，不是写死在前端：

```sql
-- 表：downloads
-- 行：id = 'rainbow-mc'
-- 字段：description
```

### 当前值

```
Minecraft 启动器 · 适配 Windows 64 位 · 支持原版 / Forge / NeoForge / Fabric、Modrinth 模组与整合包下载、社团账号登录
```

### 改成

```
Minecraft 启动器 · 适配 Windows 64 位 · 支持原版 / Forge / NeoForge / Fabric、Modrinth 模组与整合包下载、社团账号登录
核心机制借鉴 PCL2（作者 龙腾猫跃）· 本启动器由 LLM 编写
```

**是两行**，第二行单独起行。

### 改数据库的方式

```bash
cd /opt/rainbow-site/server && node -e "
const {db}=require('./models/database');
db.prepare('UPDATE downloads SET description=? WHERE id=?')
  .run(process.argv[1], 'rainbow-mc');
console.log('ok');
" "Minecraft 启动器 · 适配 Windows 64 位 · 支持原版 / Forge / NeoForge / Fabric、Modrinth 模组与整合包下载、社团账号登录
核心机制借鉴 PCL2（作者 龙腾猫跃）· 本启动器由 LLM 编写"
```

---

## 五、⚠️ 一个必须一起改的地方

卡片描述的 CSS 里，**换行符 `\n` 默认会被 HTML 吞掉**，两行会粘成一行：

```
…社团账号登录 核心机制借鉴 PCL2（作者 龙腾猫跃）· 本启动器由 LLM 编写
```

**所以必须同时改组件**：`client/src/pages/Download.jsx`

找到这一行（大约在第 203 行）：

```jsx
{item.description && <div className="desc">{item.description}</div>}
```

改成：

```jsx
{item.description && (
  <div className="desc" style={{ whiteSpace: 'pre-line' }}>
    {item.description}
  </div>
)}
```

`white-space: pre-line` 让 `\n` 生效，同时保留正常的自动换行。

改完要重新构建并部署：

```bash
cd E:\FOR AI\rainbow-site\client
npm run build
# 然后把 dist 打包上传到 /opt/rainbow-site/client/dist
```

---

## 六、改动清单汇总

| # | 文件 / 位置 | 操作 |
|---|---|---|
| 1 | `docs/RAINBOW-MC-功能介绍与架构.md` | 第九章后追加第十章、第十一章 |
| 2 | 数据库 `downloads.description`（`id='rainbow-mc'`）| 追加两行 |
| 3 | `client/src/pages/Download.jsx` 第 203 行附近 | `.desc` 加 `whiteSpace: 'pre-line'` |
| 4 | 前端构建产物 | `npm run build` 后部署到 `/opt/rainbow-site/client/dist` |

---

## 七、验收方法

```bash
# ① 文档
grep -n '## 十、' docs/RAINBOW-MC-功能介绍与架构.md
grep -n '## 十一、' docs/RAINBOW-MC-功能介绍与架构.md

# ② 数据库
sqlite3 /opt/rainbow-site/server/data/rainbow.db \
  "SELECT description FROM downloads WHERE id='rainbow-mc';"
# 应该能看到两行

# ③ 页面
curl -sk https://rainbowdoor.icu/api/downloads | grep -o '核心机制借鉴[^"]*'
```

**最后用浏览器打开 `https://rainbowdoor.icu/download`**，确认 RAINBOW MC 卡片里
「核心机制借鉴 PCL2…」是**单独一行**，没有和上一条功能粘在一起。

---

## 八、不要做的事

```
❌ 不要改动 RAINBOW MC 卡片上的「下载」按钮
❌ 不要改动页面顶部的「前往GitHub」按钮（那是另一次需求加的）
❌ 不要把设计风格相关的内容写进借鉴清单
❌ 不要删除第十章末尾那句「其余部分…不计入借鉴」
```

---

*文档生成：2026-10-24*
