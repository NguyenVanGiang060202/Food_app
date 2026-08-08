import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="mt-16 border-t border-border/60 bg-parchment/60">
      <div className="container-page grid grid-cols-2 gap-x-6 gap-y-8 py-10 md:grid-cols-4 md:py-14">
        <div className="col-span-2 md:col-span-1">
          <div className="font-display text-2xl">
            Bếp<span className="text-primary">.</span>
          </div>
          <p className="mt-3 hidden max-w-xs text-sm text-muted-foreground md:block">
            Hỏi một câu, chốt một bữa. Bếp bắt đầu từ cơn thèm của bạn rồi tìm món và quán hợp gu.
          </p>
        </div>
        {[
          {
            title: 'Chốt món',
            items: [
              { label: 'Tìm món và quán', to: '/search' },
              { label: 'Quán đang thơm', to: '/discover' },
              { label: 'Hỏi theo tâm trạng', to: '/' },
              { label: 'Mở bản đồ ăn', to: '/map' },
            ],
          },
          {
            title: 'Gu của bạn',
            items: [
              { label: 'Quán đã cất', to: '/saved' },
              { label: 'Gu ruột', to: '/profile' },
              { label: 'Vào Bếp', to: '/auth' },
            ],
          },
          {
            title: 'Bếp',
            items: [
              { label: 'Về bàn chính', to: '/' },
              { label: 'Dữ liệu quán thật', to: '/discover' },
              { label: 'Gõ cửa Bếp', to: 'mailto:hello@none.food' },
            ],
          },
        ].map((col, index) => (
          <div key={col.title} className={index === 2 ? 'hidden md:block' : ''}>
            <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {col.title}
            </div>
            <ul className="mt-3 space-y-1.5 text-sm">
              {col.items.map((item) => (
                <li key={item.label}>
                  {item.to.startsWith('mailto:') ? (
                    <a
                      href={item.to}
                      className="text-foreground/80 transition-colors hover:text-primary"
                    >
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      to={item.to}
                      className="text-foreground/80 transition-colors hover:text-primary"
                    >
                      {item.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-border/60">
        <div className="container-page flex flex-col items-start justify-between gap-2 py-4 text-xs text-muted-foreground md:flex-row md:items-center">
          <span>© {new Date().getFullYear()} Bếp - hỏi một câu, chốt một bữa.</span>
          <span>Dữ liệu để tham khảo trước khi xách bụng đi ăn</span>
        </div>
      </div>
    </footer>
  );
}
