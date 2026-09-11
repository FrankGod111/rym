import { useState } from 'react';
import { Alert, Card, Form, Input, Button, Switch, Divider, Typography, Space, message, Row, Col } from 'antd';
import { UserOutlined, KeyOutlined } from '@ant-design/icons';
import { useAppStore } from '@/stores/app-store';
import BackendLoginModal from '@/components/BackendLoginModal';
import { erpApi } from '@/api/erp';

const { Title, Text } = Typography;

export default function Settings() {
  const { currentUser } = useAppStore();
  const [authOpen, setAuthOpen] = useState(false);
  const [form] = Form.useForm();
  const [saved, setSaved] = useState(false);

  const handleSave = (values: any) => {
    console.log('Settings saved:', values);
    setSaved(true);
    message.success('设置已保存');
    setTimeout(() => setSaved(false), 2000);
  };

  const systemInfo = [
    { label: '系统版本', value: 'v2.1.0' },
    { label: '前端环境', value: 'React 18 + Vite 6 + TypeScript' },
    { label: 'AI 能力', value: '后端真实 API（PaddleOCR + Ollama + Skill 上下文）' },
    { label: '数据库', value: 'SQLite 合同台账（data/contracts.db）' },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>系统设置</Title>

      <Row gutter={16}>
        <Col span={8}>
          <Card title="用户信息" size="small">
            <Form layout="vertical" initialValues={{ name: currentUser.name, department: currentUser.erp?.department_name || '未设置部门' }}>
              <Form.Item name="name" label="用户名"><Input prefix={<UserOutlined />} /></Form.Item>
              <Form.Item name="department" label="所属部门">
                <Input disabled prefix={<KeyOutlined />} />
              </Form.Item>
              <Alert type={currentUser.erp ? 'success' : 'warning'} showIcon message={currentUser.erp ? '已连接 ERP 身份' : '当前未连接 ERP 身份'} description={currentUser.erp ? `所属部门：${currentUser.erp.department_name || '未设置部门'}` : '请使用 ERP 账号登录后进入系统。'} />
              {!currentUser.erp && <Button type="primary" onClick={() => setAuthOpen(true)} style={{ marginTop: 12 }}>连接 ERP 账号</Button>}
            </Form>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="安全设置" size="small">
            <Form layout="vertical" onFinish={handleSave}>
              <Form.Item name="enableAI" label="启用 AI 功能" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableOCR" label="启用 OCR 识别" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableNotifications" label="启用主动提醒" valuePropName="checked" initialValue={true}><Switch /></Form.Item>
              <Form.Item name="enableAutoSync" label="自动数据同步" valuePropName="checked" initialValue={false}><Switch /></Form.Item>
              <Form.Item><Button type="primary" htmlType="submit" block>保存设置</Button></Form.Item>
            </Form>
          </Card>
        </Col>
        <Col span={8}>
          <Card title="系统信息" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              {systemInfo.map(item => (
                <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">{item.label}</Text>
                  <Text code>{item.value}</Text>
                </div>
              ))}
              <Divider style={{ margin: '8px 0' }} />
              <Text type="secondary" style={{ fontSize: 11 }}>
                当前 AI 链路已经接入后端真实接口，可结合 PaddleOCR、本地 Ollama 模型与 Skill 化法规上下文执行评审。
              </Text>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card title="AI 能力说明" size="small" style={{ marginTop: 16 }}>
        <Row gutter={16}>
          <Col span={12}>
            <Title level={5}>当前已接入能力</Title>
            <ul style={{ paddingLeft: 20, fontSize: 13 }}>
              <li>OCR 识别：后端 PaddleOCR 接口</li>
              <li>合同信息提取（NER）：本地 Ollama / Qwen 模型</li>
              <li>法务预审：后端敏感词与模型审查</li>
              <li>合规性检查：Skill 化法规上下文 + 模型评审</li>
              <li>历史对比：后端基于 SQLite 合同台账做真实聚合比较</li>
            </ul>
          </Col>
          <Col span={12}>
            <Title level={5}>生产环境接入要点</Title>
            <ul style={{ paddingLeft: 20, fontSize: 13 }}>
              <li>OCR：当前默认使用 PaddleOCR，可按需替换为企业 OCR 服务</li>
              <li>NER：当前默认使用本地 Ollama / 通义千问模型，可切换其他大模型</li>
              <li>法规库：当前通过 Skill 文档 + 后端加载实现，可继续升级为企业知识库 API</li>
              <li>代码扫描：接入 SonarQube / CodeGeeX 等 SAST 工具</li>
              <li>摘要生成：接入 Embedding + RAG 检索增强</li>
              <li>OA 同步：需获取金蝶/用友对外接口授权并配置鉴权</li>
            </ul>
          </Col>
        </Row>
      </Card>
      <BackendLoginModal open={authOpen} onAuthenticated={() => setAuthOpen(false)} onCancel={() => setAuthOpen(false)} />
    </div>
  );
}
