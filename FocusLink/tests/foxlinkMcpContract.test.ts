import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

describe('Foxlink independent MCP contract', () => {
  it('keeps the business API inside Electron and outside PersonalMcpGateway', () => {
    const api = fs.readFileSync(path.join(root, 'electron/mcp/businessApi.ts'), 'utf8');
    expect(api).toContain("const HOST = '127.0.0.1'");
    // 端口只在共享合同里写一次：自动化路由与旧 /v1 路由必须共用一个 listener。
    expect(api).toContain('const PORT = AUTOMATION_LISTEN_PORT');
    const contract = fs.readFileSync(path.join(root, 'shared/automation/contract.ts'), 'utf8');
    expect(contract).toContain('export const AUTOMATION_LISTEN_PORT = 18770');
    expect(api).toContain('/v1/status');
    expect(api).toContain('/v1/health');
    expect(api).toContain('/v1/capabilities');
    // 2026-11-03：外部助手只能读 /v1 时被迫点界面，因此补上会话字段写入口。
    expect(api).toContain("'/v1/tasks'");
    expect(api).toContain("'/v1/sessions/batch-update'");
    // FL-SYNC-038：请求头前置条件与重放顺序在可注入的路由级服务里。
    const patchService = fs.readFileSync(
      path.join(root, 'electron/mcp/sessionPatchService.ts'),
      'utf8',
    );
    expect(patchService).toContain("type: 'records.update'");
    expect(api).toContain("request.headers['if-match']");
    expect(patchService).not.toContain('PersonalMcpGateway');
    expect(api).not.toContain('PersonalMcpGateway');
  });

  it('uses independent MCP and tunnel service identities', () => {
    const nativeService = fs.readFileSync(
      path.join(root, 'mcp/foxlink_mcp/windows_service.py'),
      'utf8',
    );
    const installer = fs.readFileSync(path.join(root, 'mcp/service/install.ps1'), 'utf8');
    const tunnel = fs.readFileSync(path.join(root, 'mcp/tunnel/service.xml'), 'utf8');
    const tunnelRuntime = fs.readFileSync(path.join(root, 'mcp/tunnel/run-service.ps1'), 'utf8');
    expect(nativeService).toContain('_svc_name_ = "PoyiFoxlinkMcp"');
    expect(nativeService).toContain('foxlink_mcp.windows_service.FoxlinkMcpService');
    expect(installer).toContain('-m foxlink_mcp.windows_service --startup delayed install');
    expect(tunnel).toContain('<id>FoxlinkSecureMcpTunnel</id>');
    expect(tunnel).toContain('<depend>PoyiFoxlinkMcp</depend>');
    expect(tunnelRuntime).toContain('127.0.0.1:8770/mcp');
  });
});
