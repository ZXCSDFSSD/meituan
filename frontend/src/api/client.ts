/**
 * HTTP 请求客户端（基于 Axios）
 *
 * 【Axios 是什么？】
 *   Axios 是一个流行的 HTTP 请求库，相当于浏览器原生 fetch 的增强版。
 *   用法：axios.get('/url', { params }) / axios.post('/url', body)
 *
 * 【为什么要封装一个 client？】
 *   不直接用 axios，而是通过 axios.create() 创建一个"实例"，可以：
 *   1. 统一设置 baseURL，之后所有请求只用写 '/analytics/xxx' 而不用每次写完整地址
 *   2. 统一设置超时时间（15秒）
 *   3. 通过"拦截器"统一处理响应和错误
 */

import axios from 'axios'

/**
 * axios.create() — 创建一个 Axios 实例（可以理解为"配置好的 axios"）
 *
 * baseURL: '/api'
 *   → 所有请求都以 /api 开头
 *   → 在开发时，Vite 的 proxy 配置会把 /api/xxx 转发到 http://localhost:3000/api/xxx
 *   → 这样前端代码里只写 '/analytics/overview'，实际请求会发到后端服务器
 *
 * timeout: 15000
 *   → 如果请求 15 秒内没有响应，自动报错，防止页面无限等待
 */
const client = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

/**
 * 响应拦截器（interceptors.response）
 *
 * 【拦截器是什么？】
 *   Axios 拦截器就像"中间件"，在响应到达你的代码之前，先经过拦截器处理。
 *   类似于海关检查：货物（响应）到达之前，先统一检查和处理。
 *
 * interceptors.response.use(成功处理函数, 失败处理函数)
 *
 * 【成功处理：(res) => res.data】
 *   Axios 原始响应结构是：{ data: {...}, status: 200, headers: {...} }
 *   我们只关心 data 部分（后端返回的业务数据）
 *   所以这里直接返回 res.data，这样调用方写 await client.get(...) 直接得到业务数据
 *   而不用每次都写 (await client.get(...)).data
 *
 * 【失败处理：(err) => Promise.reject(new Error(msg))】
 *   当 HTTP 请求失败时（如网络断开、服务器报错）：
 *   - err.response?.data?.error → 取后端返回的错误信息（如果有）
 *   - err.message                → 取 Axios 自身的错误信息（如"timeout"）
 *   - '请求失败'                 → 兜底的默认提示
 *   最终统一抛出一个 Error 对象，各个 hook 可以用 .catch() 捕获显示给用户
 */
client.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const msg = err.response?.data?.error || err.message || '请求失败'
    return Promise.reject(new Error(msg))
  }
)

export default client
