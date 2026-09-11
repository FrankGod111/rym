import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Form, Select, Spin, Switch, Tag, Tree, Typography, message } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { ApartmentOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { erpApi } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';
import { useAppStore } from '@/stores/app-store';

const { Title, Text } = Typography;

type PermissionNode = {
  key: string;
  title: string;
  children?: PermissionNode[];
  data?: { permissions?: Record<string, unknown>; scope_id?: string };
};

type ReferenceItem = Record<string, string>;

function toTreeData(nodes: PermissionNode[]): DataNode[] {
  return nodes.map((node) => ({ key: node.key, title: node.title, children: toTreeData(node.children || []) }));
}

export default function PermissionTree() {
  const [nodes, setNodes] = useState<PermissionNode[]>([]);
  const [selected, setSelected] = useState<PermissionNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [reference, setReference] = useState<{ users: ReferenceItem[]; roles: ReferenceItem[]; departments: ReferenceItem[]; catalogs: ReferenceItem[] }>({ users: [], roles: [], departments: [], catalogs: [] });
  const [permissionForm] = Form.useForm();
  const isAdmin = useAppStore((state) => state.currentUser.permissions.includes('*'));

  async function load() {
    setLoading(true);
    try {
      const [tree, users, roles, departments, catalogs] = await Promise.all([
        erpApi.permissionTree(), erpApi.users(), erpApi.roles(), erpApi.departments(), erpApi.archiveCatalogs(),
      ]);
      setNodes(tree as PermissionNode[]);
      setSelected((tree as PermissionNode[])[0] || null);
      setReference({
        users: users as ReferenceItem[], roles: roles as ReferenceItem[], departments: departments as ReferenceItem[], catalogs: catalogs as ReferenceItem[],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '权限树加载失败';
      if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true); else message.error(detail);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (erpApi.hasSession()) void load(); }, []);

  const flat = useMemo(() => {
    const map = new Map<string, PermissionNode>();
    const walk = (items: PermissionNode[]) => items.forEach((item) => { map.set(item.key, item); walk(item.children || []); });
    walk(nodes);
    return map;
  }, [nodes]);

  const documentId = selected?.key.match(/^document:([^:]+)$/)?.[1] || '';
  const catalogId = selected?.key.match(/^catalog:([^:]+)$/)?.[1] || '';
  const editableType = documentId ? 'document' : catalogId ? 'catalog' : '';

  async function selectNode(key: string) {
    const node = flat.get(key);
    if (!node) return;
    setSelected(node);
    permissionForm.resetFields();
    const nextDocumentId = key.match(/^document:([^:]+)$/)?.[1];
    const nextCatalogId = key.match(/^catalog:([^:]+)$/)?.[1];
    if (nextDocumentId) {
      try {
        const doc = await erpApi.getDocument(nextDocumentId);
        permissionForm.setFieldsValue(doc.permissions || {});
      } catch { permissionForm.resetFields(); }
    } else if (nextCatalogId) {
      permissionForm.setFieldsValue({
        allowed_actions: ['read', 'write', 'coverage', 'missing', 'download'],
        inherit_to_documents: true,
        ...(node.data?.permissions || {}),
      });
    }
  }

  async function savePermissions(values: Record<string, unknown>) {
    if (!editableType) return;
    setSaving(true);
    try {
      if (editableType === 'document') await erpApi.updateDocumentPermissions(documentId, values);
      else await erpApi.updateCatalogPermissions(catalogId, values);
      message.success(editableType === 'document' ? '文档权限已保存' : '目录权限已保存');
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '权限保存失败');
    } finally { setSaving(false); }
  }

  const subjectFields = <>
    <Form.Item name="department_ids" label="允许部门"><Select mode="multiple" options={reference.departments.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
    <Form.Item name="role_ids" label="允许角色"><Select mode="multiple" options={reference.roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
    <Form.Item name="user_ids" label="允许用户"><Select mode="multiple" options={reference.users.map((item) => ({ value: item.id, label: `${item.name} · ${item.username}` }))} /></Form.Item>
    <Form.Item name="deny_department_ids" label="部门黑名单"><Select mode="multiple" options={reference.departments.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
    <Form.Item name="deny_role_ids" label="角色黑名单"><Select mode="multiple" options={reference.roles.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
    <Form.Item name="deny_user_ids" label="用户黑名单"><Select mode="multiple" options={reference.users.map((item) => ({ value: item.id, label: `${item.name} · ${item.username}` }))} /></Form.Item>
  </>;

  return <div style={{ maxWidth: 1280, margin: '0 auto' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
      <div><Text type="secondary">安全治理</Text><Title level={3} style={{ margin: '4px 0' }}>文档与目录权限</Title><Text type="secondary">通过用户、角色、部门和目录策略管理文档展示、检索与下载范围。</Text></div>
      <Tag color="blue" icon={<SafetyCertificateOutlined />}>后端强校验</Tag>
    </div>
    <Alert type="info" showIcon message="角色能力与数据范围分开控制" description="角色决定能执行什么操作，目录和文档黑白名单决定能访问哪些数据；黑名单始终优先。" style={{ marginBottom: 16 }} />
    <Card styles={{ body: { padding: 0 } }}>
      {loading ? <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div> : nodes.length ? <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 36%) 1fr', minHeight: 600 }}>
        <div style={{ padding: 18, borderRight: '1px solid #edf1f5', overflow: 'auto' }}>
          <Tree showLine defaultExpandAll blockNode treeData={toTreeData(nodes)} selectedKeys={selected ? [selected.key] : []} onSelect={(keys) => void selectNode(String(keys[0] || ''))} />
        </div>
        <div style={{ padding: 24 }}>
          {selected ? <>
            <Title level={4} style={{ marginTop: 0 }}><ApartmentOutlined style={{ marginRight: 8, color: '#1a73e8' }} />{selected.title}</Title>
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="节点编号"><Text code>{selected.key}</Text></Descriptions.Item>
              <Descriptions.Item label="下属节点">{selected.children?.length || 0}</Descriptions.Item>
              <Descriptions.Item label="控制范围">{editableType === 'catalog' ? '目录可见、覆盖看板、缺失提醒及目录内文档继承' : editableType === 'document' ? '文档展示、Dify 检索与下载' : '选择目录或文档节点后可查看具体权限'}</Descriptions.Item>
            </Descriptions>
            {editableType && (isAdmin ? <Form form={permissionForm} layout="vertical" onFinish={savePermissions} style={{ marginTop: 24 }}>
              {editableType === 'document' && <Form.Item name="catalog_ids" label="额外关联目录"><Select mode="multiple" options={reference.catalogs.map((item) => ({ value: item.id, label: `${item.scope_name || ''} · ${item.name}` }))} /></Form.Item>}
              {subjectFields}
              {editableType === 'catalog' ? <>
                <Form.Item name="allowed_actions" label="目录允许操作"><Select mode="multiple" options={[{ value: 'read', label: '查看目录' }, { value: 'write', label: '维护目录' }, { value: 'coverage', label: '查看覆盖看板' }, { value: 'missing', label: '查看缺失提醒' }, { value: 'download', label: '下载目录文档' }]} /></Form.Item>
                <Form.Item name="inherit_to_documents" label="权限继承到目录内文档" valuePropName="checked"><Switch /></Form.Item>
              </> : <Form.Item name="download_enabled" label="允许下载" valuePropName="checked"><Switch /></Form.Item>}
              <Button type="primary" htmlType="submit" loading={saving}>保存{editableType === 'catalog' ? '目录' : '文档'}权限</Button>
            </Form> : <Alert type="warning" showIcon message="只读权限树" description="当前账号可以查看权限关系，只有管理员可以修改黑白名单和继承规则。" style={{ marginTop: 20 }} />)}
          </> : <Empty description="选择左侧节点查看详情" />}
        </div>
      </div> : <Empty description="暂无权限数据" style={{ padding: 64 }} />}
    </Card>
    <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
  </div>;
}
