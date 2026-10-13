/**
 * 必须先于任何读取 electron-store / settingsStore 的模块执行。
 *
 * `electron <script>` 的默认 userData 取自应用名，会落到 `%APPDATA%\Electron`；而
 * electron-store 在**构造时**就把 cwd 钉死，晚于它再调用 `app.setPath('userData', ...)`
 * 只会让设置静默读成默认值（表现为「deviceSync 开关读不到、实时专注读不到凭据」）。
 * 因此这里做成独立模块，并在运维入口里作为**第一条 import** 引入。
 */
import path from 'node:path';
import { app } from 'electron';

app.setPath('userData', path.join(process.env.APPDATA ?? app.getPath('appData'), 'FocusLink'));
