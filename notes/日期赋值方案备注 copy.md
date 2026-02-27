
<!-- 
## 没意义 必须写模拟点击 

美团报表页面（orderList）的日期输入框 placeholder 为 **"请选择日期"**，
通过以下方式可以成功赋值：

```js
const setDate = (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.blur();
};

const dateInputs = document.querySelectorAll('input[placeholder="请选择日期"]');  这个直接在top 层里面

这个直接在内部ifream 里面
const dateInputs = document.querySelectorAll('input[placeholder="开始日期"]');

// dateInputs[0] = 开始日期
// dateInputs[1] = 结束日期
setDate(dateInputs[0], '2026/02/01');
setDate(dateInputs[1], '2026/02/01');
```
 -->


