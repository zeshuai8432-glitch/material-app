# material-app

倉庫材料管理系統（PWA）

## Git 規則

- **直接 push 到 main**，不開 feature branch，不建 PR
- 每次改完直接 `git push origin main`

## 專案說明

單一 `index.html` 包含所有 CSS、HTML、JS，搭配 Google Apps Script 做雲端同步。

## 使用者工作流程（照這個順序對應頁籤）

1. **需求單** — 接到案場，計算各樓層材料需求
2. **生產** — 下單生產，完成後登記入庫
3. **庫存** — 確認工廠倉庫現況
4. **出貨** — 通知出貨，建立出貨清單
5. **分配** — 材料到案場暫存區，分配到各樓層
