import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
  message,
} from 'antd';
import {
  CloudSyncOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import type { UploadProps } from 'antd';
import { erpApi, type DocumentRecord } from '@/api/erp';
import BackendLoginModal from '@/components/BackendLoginModal';

const { Title, Text, Paragraph } = Typography;

const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  indexing: '索引中',
  indexed: '已索引',
  failed: '失败',
  archived: '已归档',
  pending: '待处理',
  running: '处理中',
  completed: '已完成',
  synced: '已同步',
  disabled: '未启用',
};

function statusColor(value = '') {
  if (['indexed', 'completed', 'synced'].includes(value)) return 'green';
  if (['failed', 'deleted'].includes(value)) return 'red';
  if (['indexing', 'running', 'pending'].includes(value)) return 'blue';
  return 'default';
}

function fileType(record: DocumentRecord) {
  const name = record.file_name || record.title;
  const suffix = name.split('.').pop();
  return suffix && suffix !== name ? suffix.toUpperCase() : 'DOC';
}

export default function KnowledgeDocs() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<DocumentRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [workingId, setWorkingId] = useState('');
  const [authOpen, setAuthOpen] = useState(!erpApi.hasSession());
  const [form] = Form.useForm();

  async function load(nextQuery = query) {
    setLoading(true);
    try {
      const result = await erpApi.listDocuments(nextQuery.trim());
      setDocuments(result.documents || []);
    } catch (error) {
      handleError(error, '文档加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(''); }, []);

  function handleError(error: unknown, fallback: string) {
    const detail = error instanceof Error ? error.message : fallback;
    if (detail === 'ERP_AUTH_REQUIRED') setAuthOpen(true);
    else message.error(detail);
  }

  const summary = useMemo(() => ({
    total: documents.length,
    indexed: documents.filter((item) => ['indexed', 'completed'].includes(String(item.index_status || item.status))).length,
    synced: documents.filter((item) => item.knowledge_sync_status === 'synced' || Boolean(item.dify_document_id)).length,
    attention: documents.filter((item) => ['failed', 'pending'].includes(String(item.index_status || item.status))).length,
  }), [documents]);

  async function inspect(record: DocumentRecord) {
    setSelected(record);
    setDetailOpen(true);
    try {
      setSelected(await erpApi.getDocument(record.id));
    } catch {
      // List data remains useful when the detail endpoint is temporarily unavailable.
    }
  }

  function edit(record: DocumentRecord) {
    setSelected(record);
    form.setFieldsValue({
      title: record.title,
      category: record.category || 'General',
      tags: record.tags || [],
      visibility: record.visibility || 'department',
      document_type: record.document_type || '通用文档',
      confidentiality_level: record.confidentiality_level || 'internal',
      ai_enabled: Boolean(record.ai_enabled),
      ai_usage_scope: String(record.ai_usage_scope || (record.ai_enabled ? 'ai_answer' : 'archive_only')),
    });
    setEditOpen(true);
  }

  async function save() {
    if (!selected) return;
    const values = await form.validateFields();
    setWorkingId(selected.id);
    try {
      const payload: Record<string, unknown> = { ...values };
      if (values.ai_enabled) {
        // Knowledge-library docs often miss archive fields; fill gate prerequisites so sync can proceed.
        if (!selected.org_unit_id && selected.department_id) payload.org_unit_id = selected.department_id;
        if (!selected.archive_category) payload.archive_category = values.category || selected.category || '业务资料';
        if (!selected.document_type) payload.document_type = values.document_type || '通用文档';
        if (String(selected.filing_status || '') !== 'filed') payload.filing_status = 'filed';
        if (!selected.knowledge_dataset_key) payload.knowledge_dataset_key = 'default';
        if (!values.ai_usage_scope || values.ai_usage_scope === 'archive_only') {
          payload.ai_usage_scope = 'ai_answer';
        }
      }
      const updated = await erpApi.updateDocument(selected.id, payload);
      setDocuments((prev) => prev.map((item) => item.id === selected.id ? { ...item, ...updated } : item));
      setSelected(updated);
      setEditOpen(false);
      message.success(values.ai_enabled ? '已启用 AI，可继续点击「同步到知识库」' : '文档信息已保存');
    } catch (error) {
      handleError(error, '保存失败');
    } finally {
      setWorkingId('');
    }
  }

  async function remove(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.deleteDocument(record.id);
      setDocuments((prev) => prev.filter((item) => item.id !== record.id));
      if (selected?.id === record.id) setDetailOpen(false);
      message.success('文档已移入回收状态');
    } catch (error) {
      handleError(error, '删除失败');
    } finally {
      setWorkingId('');
    }
  }

  async function sync(record: DocumentRecord) {
    setWorkingId(record.id);
    try {
      await erpApi.syncDocument(record.id);
      message.success('已提交至知识库');
      await load();
    } catch (error) {
      handleError(error, '知识库同步失败');
    } finally {
      setWorkingId('');
    }
  }

  const uploadProps: UploadProps = {
    multiple: true,
    showUploadList: false,
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.txt,.csv,.png,.jpg,.jpeg',
    customRequest: async ({ file, onSuccess, onError }) => {
      setUploading(true);
      try {
        const source = file as File;
        await erpApi.uploadDocument(source, {
          title: source.name.replace(/\.[^.]+$/, ''),
          category: '业务资料',
          visibility: 'department',
          ai_enabled: true,
          ai_usage_scope: 'ai_answer',
          filing_status: 'filed',
          archive_category: '业务资料',
          document_type: '通用文档',
          knowledge_dataset_key: 'default',
        });
        onSuccess?.({});
        message.success(`${source.name} 已进入解析队列`);
        await load();
      } catch (error) {
        onError?.(error as Error);
        handleError(error, '上传失败');
      } finally {
        setUploading(false);
      }
    },
  };

  const columns = [
    {
      title: '文档', key: 'document', width: 300,
      render: (_: unknown, record: DocumentRecord) => (
        <button className="text-link doc-title" onClick={() => void inspect(record)}>
          <FileTextOutlined />
          <span><strong>{record.title}</strong><small>{record.file_name || record.id}</small></span>
        </button>
      ),
    },
    { title: '类型', key: 'type', width: 80, render: (_: unknown, record: DocumentRecord) => <Tag>{fileType(record)}</Tag> },
    { title: '分类', dataIndex: 'category', key: 'category', width: 120, render: (value: string) => value || '未分类' },
    {
      title: '解析 / 索引', key: 'status', width: 170,
      render: (_: unknown, record: DocumentRecord) => {
        const value = String(record.index_status || record.parse_status || record.status || 'pending');
        return <Tag color={statusColor(value)}>{statusLabels[value] || value}</Tag>;
      },
    },
    {
      title: 'AI', key: 'ai', width: 100,
      render: (_: unknown, record: DocumentRecord) => (
        <Tag color={record.ai_enabled ? 'green' : 'default'}>{record.ai_enabled ? '已启用' : '未启用'}</Tag>
      ),
    },
    {
      title: 'Dify', key: 'dify', width: 120,
      render: (_: unknown, record: DocumentRecord) => {
        const value = String(record.knowledge_sync_status || (record.dify_document_id ? 'synced' : 'disabled'));
        return <Tag color={statusColor(value)}>{statusLabels[value] || value}</Tag>;
      },
    },
    { title: '更新', key: 'updated', width: 130, render: (_: unknown, record: DocumentRecord) => dayjs(String(record.updatedAt || record.updated_at || '')).isValid() ? dayjs(String(record.updatedAt || record.updated_at)).format('YYYY-MM-DD') : '-' },
    {
      title: '操作', key: 'actions', fixed: 'right' as const, width: 240,
      render: (_: unknown, record: DocumentRecord) => (
        <Space size={2}>
          <Button type="text" size="small" title="查看" icon={<EyeOutlined />} onClick={() => void inspect(record)} />
          <Button type="text" size="small" title="编辑" icon={<EditOutlined />} onClick={() => edit(record)} />
          <Button type="text" size="small" title="同步到知识库" aria-label="同步到知识库" icon={<CloudSyncOutlined />} loading={workingId === record.id} onClick={() => void sync(record)} />
          <Popconfirm title="删除该文档？" description="文档将从当前列表移除。" onConfirm={() => void remove(record)}>
            <Button type="text" danger size="small" title="删除" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="workspace-page">
      <div className="page-heading">
        <div>
          <Title level={3}>知识文档</Title>
          <Text type="secondary">文件入库、解析、权限维护与知识库索引同步</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>刷新</Button>
          <Upload {...uploadProps}><Button type="primary" icon={<UploadOutlined />} loading={uploading}>上传文件</Button></Upload>
        </Space>
      </div>

      <div className="metric-strip">
        <div><span>文档总数</span><strong>{summary.total}</strong></div>
        <div><span>已完成索引</span><strong>{summary.indexed}</strong></div>
        <div><span>已同步知识库</span><strong>{summary.synced}</strong></div>
        <div><span>需要处理</span><strong className={summary.attention ? 'metric-warning' : ''}>{summary.attention}</strong></div>
      </div>

      <section className="table-workspace">
        <div className="table-toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索标题、文件名或标签"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onPressEnter={() => void load()}
          />
          <Button onClick={() => void load()}>查询</Button>
        </div>
        <Table<DocumentRecord>
          rowKey="id"
          loading={loading}
          dataSource={documents}
          columns={columns}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 10, showTotal: (total) => `共 ${total} 条` }}
          locale={{ emptyText: <Empty description="暂无文档，上传文件后会在这里显示解析状态" /> }}
        />
      </section>

      <Drawer title="文档详情" width={620} open={detailOpen} onClose={() => setDetailOpen(false)} extra={selected && <Button icon={<EditOutlined />} onClick={() => edit(selected)}>编辑</Button>}>
        {selected && (
          <Space direction="vertical" size={20} style={{ width: '100%' }}>
            <div className="detail-title"><FileTextOutlined /><div><Title level={4}>{selected.title}</Title><Text type="secondary">{selected.file_name || selected.id}</Text></div></div>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="文档 ID" span={2}>{selected.id}</Descriptions.Item>
              <Descriptions.Item label="分类">{selected.category || '-'}</Descriptions.Item>
              <Descriptions.Item label="类型">{selected.document_type || fileType(selected)}</Descriptions.Item>
              <Descriptions.Item label="可见范围">{selected.visibility || '-'}</Descriptions.Item>
              <Descriptions.Item label="密级">{selected.confidentiality_level || '-'}</Descriptions.Item>
              <Descriptions.Item label="允许 AI">{selected.ai_enabled ? '已启用' : '未启用'}</Descriptions.Item>
              <Descriptions.Item label="AI 用途">{String(selected.ai_usage_scope || '-')}</Descriptions.Item>
              <Descriptions.Item label="解析状态">{String(selected.parse_status || selected.index_status || selected.status || '-')}</Descriptions.Item>
              <Descriptions.Item label="Dify 状态">{String(selected.knowledge_sync_status || '-')}</Descriptions.Item>
            </Descriptions>
            <div>
              <Text strong>标签</Text>
              <div style={{ marginTop: 8 }}>{selected.tags?.length ? selected.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : <Text type="secondary">暂无标签</Text>}</div>
            </div>
            {selected.content_text && <div><Text strong>解析内容</Text><Paragraph className="content-preview">{selected.content_text}</Paragraph></div>}
          </Space>
        )}
      </Drawer>

      <Modal title="编辑文档信息" open={editOpen} onOk={() => void save()} confirmLoading={Boolean(workingId)} onCancel={() => setEditOpen(false)} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true, message: '请输入标题' }]}><Input /></Form.Item>
          <Form.Item name="category" label="业务分类"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
          <Form.Item name="document_type" label="文档类型"><Input /></Form.Item>
          <Space size={16} align="start" style={{ width: '100%' }}>
            <Form.Item name="visibility" label="可见范围" style={{ minWidth: 190 }}><Select options={[{ value: 'public', label: '公开' }, { value: 'department', label: '部门' }, { value: 'private', label: '仅本人' }, { value: 'admin', label: '仅管理员' }]} /></Form.Item>
            <Form.Item name="confidentiality_level" label="密级" style={{ minWidth: 190 }}><Select options={[{ value: 'public', label: '公开' }, { value: 'internal', label: '内部' }, { value: 'department', label: '部门敏感' }, { value: 'sensitive', label: '敏感' }, { value: 'restricted', label: '受限' }]} /></Form.Item>
          </Space>
          <Space size={28} align="start">
            <Form.Item name="ai_enabled" label="允许 AI 使用" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name="ai_usage_scope" label="AI 用途" extra="未启用 AI 的历史文档可在此打开开关，保存后再点「同步到知识库」。">
            <Select options={[
              { value: 'archive_only', label: '仅归档' },
              { value: 'ai_search', label: '允许检索' },
              { value: 'ai_answer', label: '允许生成回答' },
            ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <BackendLoginModal open={authOpen} onAuthenticated={() => { setAuthOpen(false); void load(); }} />
    </div>
  );
}
