"use client";

import { Inbox, Plus, Tent } from "lucide-react";
import { PageHeader } from "@/app/pageHeaderContext";
import { PageContainer } from "@/components/page-container";
import { SectionHeader } from "@/components/section-header";
import { LoadingRows } from "@/components/loading-rows";
import { EmptyState } from "@/components/empty-state";
import { ResponsiveTable } from "@/components/responsive-table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

// The living reference of the UI primitives and conventions (AGENTS.md →
// "Frontend UI recipe"). Agents and humans copy patterns from here; extend it
// whenever a primitive or a token is added.

const SEMANTIC_TOKENS = [
  ["destructive", "ошибки, удаление"],
  ["success", "рейтинг вырос, выполнено"],
  ["warning", "устарело, в ожидании"],
  ["info", "нейтральное уведомление"],
] as const;

const CHART_TOKENS = Array.from({ length: 10 }, (_, i) => `chart-${i + 1}`);

export default function StyleguidePage() {
  return (
    <PageContainer width="wide">
      <PageHeader title="Стильгайд" />

      <p className="text-sm text-muted-foreground">
        Эталон примитивов и правил оформления. Любая новая страница строится из
        блоков ниже; рецепты — в AGENTS.md («Frontend UI recipe»).
      </p>

      <section className="space-y-3">
        <SectionHeader>Семантические токены</SectionHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SEMANTIC_TOKENS.map(([token, usage]) => (
            <div key={token} className="flex items-center gap-2 rounded-lg border p-2">
              <span
                className="size-8 shrink-0 rounded-md border"
                style={{ backgroundColor: `var(--${token})` }}
              />
              <span className="min-w-0 text-xs">
                <span className="block font-mono font-semibold">--{token}</span>
                <span className="block text-muted-foreground">{usage}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {CHART_TOKENS.map((token) => (
            <div key={token} className="flex flex-col items-center gap-1">
              <span
                className="size-8 rounded-md border"
                style={{ backgroundColor: `var(--${token})` }}
              />
              <span className="font-mono text-xs text-muted-foreground">
                {token}
              </span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Сырые палитры Tailwind (<code>text-red-600</code>,{" "}
          <code>bg-emerald-500</code>…) запрещены линтом — только эти токены.
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeader>Кнопки</SectionHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Button>Действие</Button>
          <Button variant="secondary">Вторичная</Button>
          <Button variant="outline">Контурная</Button>
          <Button variant="ghost">Прозрачная</Button>
          <Button variant="link">Ссылка</Button>
          <Button variant="destructive">Удалить</Button>
          <Button size="sm">Компактная</Button>
          <Button disabled>Недоступна</Button>
          <Button className="pointer-events-none">
            <Spinner /> Сохранение…
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Действие страницы живёт в шапке (<code>PageHeader action</code>), не в
          теле списка.
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeader>Поля ввода</SectionHeader>
        <div className="grid max-w-md gap-4">
          <div className="grid gap-2">
            <Label htmlFor="sg-name">Название</Label>
            <Input id="sg-name" placeholder="Например, Skull King" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-error">Ошибка</Label>
            <Input id="sg-error" aria-invalid placeholder="обязательное поле" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="sg-disabled">Заблокировано</Label>
            <Input id="sg-disabled" disabled />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="sg-switch">Переключатель</Label>
            <Switch id="sg-switch" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader>Уведомления и бейджи</SectionHeader>
        <Alert>
          <AlertTitle>Информация</AlertTitle>
          <AlertDescription>
            Вариант по умолчанию — нейтральное пояснение.
          </AlertDescription>
        </Alert>
        <Alert variant="warning">
          <AlertTitle>Внимание</AlertTitle>
          <AlertDescription>
            Токен --warning: устаревшие данные, незавершённые операции.
          </AlertDescription>
        </Alert>
        <Alert variant="destructive">
          <AlertTitle>Ошибка</AlertTitle>
          <AlertDescription>
            Токен --destructive: сбой запроса, некорректный ввод.
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-2">
          <Badge>Бейдж</Badge>
          <Badge variant="secondary">Вторичный</Badge>
          <Badge variant="outline">Контурный</Badge>
          <Badge variant="destructive">Опасный</Badge>
        </div>
      </section>

      <section className="space-y-3">
        <SectionHeader>Состояния списков</SectionHeader>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Загрузка — LoadingRows
            </CardTitle>
          </CardHeader>
          <CardContent>
            <LoadingRows count={3} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Пусто — EmptyState
            </CardTitle>
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Inbox}
              title="Пока ничего нет"
              action={
                <Button size="sm" variant="outline">
                  <Plus /> Создать
                </Button>
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">
              Скелетон — Skeleton
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionHeader>Таблица + карточки (ResponsiveTable)</SectionHeader>
        <ResponsiveTable
          mobile={
            <div className="divide-y rounded-lg border">
              {["Алиса", "Боб", "Вика"].map((name, i) => (
                <div key={name} className="flex items-center justify-between p-3">
                  <span className="font-medium">{name}</span>
                  <Badge variant="secondary">{1200 - i * 30} Elo</Badge>
                </div>
              ))}
            </div>
          }
          desktop={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Игрок</th>
                  <th className="py-2 font-medium">Elo</th>
                </tr>
              </thead>
              <tbody>
                {["Алиса", "Боб", "Вика"].map((name, i) => (
                  <tr key={name} className="border-b last:border-0">
                    <td className="py-2">{name}</td>
                    <td className="py-2">{1200 - i * 30}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </section>

      <section className="space-y-3">
        <SectionHeader>Прочее</SectionHeader>
        <div className="flex flex-wrap items-center gap-4">
          <Tabs defaultValue="a">
            <TabsList>
              <TabsTrigger value="a">Вкладка</TabsTrigger>
              <TabsTrigger value="b">Ещё</TabsTrigger>
            </TabsList>
          </Tabs>
          <Badge variant="outline" className="gap-1">
            <Tent className="size-3" /> Иконка 16px (size-4)
          </Badge>
          <span className="text-success font-medium">+24 Elo</span>
          <span className="text-destructive font-medium">−18 Elo</span>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Карточка</CardTitle>
            <CardDescription>
              Разделы списков — Card с divide-y внутри CardContent.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Заголовки разделов страницы — SectionHeader, не произвольные
            text-lg/text-sm.
          </CardContent>
        </Card>
      </section>
    </PageContainer>
  );
}
