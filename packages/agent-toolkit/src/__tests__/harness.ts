/** 测试里要等一个"后台进程已经跑起来/退出了"的短延迟。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
