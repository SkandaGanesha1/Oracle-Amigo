import {
  Alert,
  AlertDialog,
  Autocomplete,
  Avatar,
  Badge,
  Breadcrumbs,
  Button,
  ButtonGroup,
  Calendar,
  Card,
  Chip,
  ComboBox,
  DatePicker,
  Drawer,
  Dropdown,
  Input,
  InputGroup,
  Kbd,
  ListBox,
  Meter,
  Modal,
  Pagination,
  Popover,
  ProgressBar,
  ProgressCircle,
  ScrollShadow,
  SearchField,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Surface,
  Switch,
  Table,
  Tabs,
  TextArea,
  ToastProvider,
  ToggleButton,
  ToggleButtonGroup,
  Toolbar,
  Tooltip
} from "@heroui/react";
import { Bell, CalendarDays, Check, ChevronDown, Command, FileCheck, ShieldAlert } from "lucide-react";
import type { FC } from "react";

const demoItems = [
  { id: "relay", label: "Relay polling" },
  { id: "approval", label: "Human approval" },
  { id: "receipt", label: "Transfer receipt" }
];

export const ComponentLabPage: FC = () => (
  <div className="flex h-full min-h-0 flex-col gap-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Breadcrumbs aria-label="Admin breadcrumbs">
          <Breadcrumbs.Item href="#/">Admin</Breadcrumbs.Item>
          <Breadcrumbs.Item href="#/components">Component Lab</Breadcrumbs.Item>
        </Breadcrumbs>
        <h1 className="mt-2 text-base font-semibold text-white">Design System / Component Lab</h1>
        <p className="text-xs text-white/55">
          Gated HeroUI catalog for Oracle Amigo UI work; production screens use the same primitives with live data.
        </p>
      </div>
      <Toolbar aria-label="Component lab toolbar" className="flex-wrap">
        <Tooltip>
          <Tooltip.Trigger>
            <Button size="sm" variant="secondary"><Command className="h-3.5 w-3.5" /> Command</Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Keyboard shortcut surfaces use Kbd and Toolbar.</Tooltip.Content>
        </Tooltip>
        <Kbd><Kbd.Content>Ctrl K</Kbd.Content></Kbd>
      </Toolbar>
    </header>

    <ScrollShadow className="min-h-0 flex-1 pr-1">
      <div className="grid gap-4 xl:grid-cols-2">
        <Surface className="rounded-xl border border-white/10 bg-[#08080a]/80 p-4">
          <h2 className="text-sm font-semibold text-white">Core Actions</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <ButtonGroup>
              <Button size="sm" variant="primary"><Check className="h-3.5 w-3.5" /> Approve</Button>
              <ButtonGroup.Separator />
              <Button size="sm" variant="danger-soft">Reject</Button>
            </ButtonGroup>
            <Avatar size="sm"><Avatar.Fallback>OA</Avatar.Fallback></Avatar>
            <Badge color="danger" size="sm"><Badge.Label>3</Badge.Label></Badge>
            <Chip color="success" size="sm" variant="soft">Relay online</Chip>
            <Spinner size="sm" />
          </div>
          <Separator className="my-4" />
          <Alert status="success">
            <Alert.Indicator><Check className="h-4 w-4" /></Alert.Indicator>
            <Alert.Content>
              <Alert.Title>Accessible status feedback</Alert.Title>
              <Alert.Description>Use Alert and Toast for transfer, heartbeat, and approval outcomes.</Alert.Description>
            </Alert.Content>
          </Alert>
          <ToastProvider aria-label="Admin toast region" />
        </Surface>

        <Card className="rounded-xl border border-white/10 bg-[#08080a]/80">
          <Card.Header>
            <Card.Title>Inputs and Search</Card.Title>
            <Card.Description>Form primitives for auth, settings, filters, and command search.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-3">
            <Input aria-label="Agent name" placeholder="Agent display name" />
            <InputGroup>
              <InputGroup.Prefix><FileCheck className="h-4 w-4" /></InputGroup.Prefix>
              <InputGroup.Input aria-label="File request command" placeholder="/request-file Q4 forecast" />
              <InputGroup.Suffix><Button size="sm" variant="secondary">Run</Button></InputGroup.Suffix>
            </InputGroup>
            <SearchField aria-label="Directory search">
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Search people, devices, files" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>
            <TextArea aria-label="Approval feedback" placeholder="Refine approval search..." rows={3} />
          </Card.Content>
        </Card>

        <Card className="rounded-xl border border-white/10 bg-[#08080a]/80">
          <Card.Header>
            <Card.Title>Navigation and Selection</Card.Title>
            <Card.Description>Tabs, dropdowns, list boxes, select, autocomplete, and combo box patterns.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-3">
            <Tabs aria-label="Inspector tabs" defaultSelectedKey="agent">
              <Tabs.List>
                <Tabs.Tab id="agent">Agent</Tabs.Tab>
                <Tabs.Tab id="files">Files</Tabs.Tab>
                <Tabs.Tab id="audit">Audit</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel id="agent">Agent capability summary</Tabs.Panel>
              <Tabs.Panel id="files">Received files and receipts</Tabs.Panel>
              <Tabs.Panel id="audit">Hash chained audit events</Tabs.Panel>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              <Dropdown>
                <Dropdown.Trigger><Button size="sm" variant="outline">Actions <ChevronDown className="h-3.5 w-3.5" /></Button></Dropdown.Trigger>
                <Dropdown.Popover>
                  <Dropdown.Menu aria-label="Actions">
                    <Dropdown.Item id="copy">Copy ID</Dropdown.Item>
                    <Dropdown.Item id="revoke">Revoke</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
              <Select aria-label="Relay mode"><Select.Trigger><Select.Value>Polling</Select.Value></Select.Trigger></Select>
              <Autocomplete aria-label="Mention agent"><Autocomplete.Trigger>@agent</Autocomplete.Trigger></Autocomplete>
              <ComboBox aria-label="Indexed folder"><ComboBox.Trigger>Choose folder</ComboBox.Trigger></ComboBox>
            </div>
            <ListBox aria-label="Command list" selectionMode="single">
              {demoItems.map((item) => <ListBox.Item key={item.id} id={item.id}>{item.label}</ListBox.Item>)}
            </ListBox>
            <Pagination aria-label="Audit pagination" size="sm">
              <Pagination.Summary>Page 2 of 8</Pagination.Summary>
              <Pagination.Content>
                <Pagination.Item><Pagination.Previous>Previous</Pagination.Previous></Pagination.Item>
                <Pagination.Item><Pagination.Link>1</Pagination.Link></Pagination.Item>
                <Pagination.Item><Pagination.Link isActive>2</Pagination.Link></Pagination.Item>
                <Pagination.Item><Pagination.Ellipsis /></Pagination.Item>
                <Pagination.Item><Pagination.Next>Next</Pagination.Next></Pagination.Item>
              </Pagination.Content>
            </Pagination>
          </Card.Content>
        </Card>

        <Card className="rounded-xl border border-white/10 bg-[#08080a]/80">
          <Card.Header>
            <Card.Title>Progress and State</Card.Title>
            <Card.Description>Transfer, indexing, and confidence-state display primitives.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-4">
            <ProgressBar value={68} aria-label="Transfer progress">
              <ProgressBar.Output>Transfer 68%</ProgressBar.Output>
              <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
            </ProgressBar>
            <div className="flex items-center gap-4">
              <ProgressCircle value={72} aria-label="Heartbeat quality">
                <ProgressCircle.Track><ProgressCircle.TrackCircle /><ProgressCircle.FillCircle /></ProgressCircle.Track>
              </ProgressCircle>
              <Meter value={82} aria-label="Approval confidence">
                <Meter.Output>Confidence 82%</Meter.Output>
                <Meter.Track><Meter.Fill /></Meter.Track>
              </Meter>
              <Skeleton className="h-8 w-40 rounded-md" />
            </div>
            <Switch isSelected aria-label="Strict approval">
              <Switch.Control><Switch.Thumb /></Switch.Control>
              <Switch.Content>Strict approval required</Switch.Content>
            </Switch>
            <ToggleButtonGroup aria-label="Composer mode" selectionMode="single" defaultSelectedKeys={["chat"]}>
              <ToggleButton id="chat">Chat</ToggleButton>
              <ToggleButton id="file">File request</ToggleButton>
              <ToggleButton id="agent">Agent</ToggleButton>
            </ToggleButtonGroup>
          </Card.Content>
        </Card>

        <Card className="rounded-xl border border-white/10 bg-[#08080a]/80">
          <Card.Header>
            <Card.Title>Overlays and Confirmation</Card.Title>
            <Card.Description>Modal, drawer, popover, tooltip, and destructive confirmation patterns.</Card.Description>
          </Card.Header>
          <Card.Content className="flex flex-wrap gap-2">
            <Popover>
              <Popover.Trigger><Button size="sm" variant="outline">Capability</Button></Popover.Trigger>
              <Popover.Content><Popover.Dialog><Popover.Heading>Agent tool</Popover.Heading><p className="text-xs">Search approved local indexes.</p></Popover.Dialog></Popover.Content>
            </Popover>
            <Modal>
              <Modal.Trigger><Button size="sm" variant="secondary">Open modal</Button></Modal.Trigger>
              <Modal.Backdrop>
                <Modal.Container>
                  <Modal.Dialog>
                    <Modal.Header><Modal.Heading>Enrollment preview</Modal.Heading></Modal.Header>
                    <Modal.Body>Modal is used for setup, previews, and diagnostics.</Modal.Body>
                    <Modal.Footer><Modal.CloseTrigger>Close</Modal.CloseTrigger></Modal.Footer>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>
            <Drawer>
              <Drawer.Trigger><Button size="sm" variant="secondary">Open drawer</Button></Drawer.Trigger>
              <Drawer.Backdrop>
                <Drawer.Content placement="right">
                  <Drawer.Dialog>
                    <Drawer.Header><Drawer.Heading>Inspector drawer</Drawer.Heading></Drawer.Header>
                    <Drawer.Body>Mobile details and file preview surface.</Drawer.Body>
                    <Drawer.Footer><Drawer.CloseTrigger>Close</Drawer.CloseTrigger></Drawer.Footer>
                  </Drawer.Dialog>
                </Drawer.Content>
              </Drawer.Backdrop>
            </Drawer>
            <AlertDialog>
              <AlertDialog.Trigger><Button size="sm" variant="danger-soft"><ShieldAlert className="h-3.5 w-3.5" /> Revoke</Button></AlertDialog.Trigger>
              <AlertDialog.Backdrop>
                <AlertDialog.Container>
                  <AlertDialog.Dialog>
                    <AlertDialog.Header><AlertDialog.Heading>Confirm revocation</AlertDialog.Heading></AlertDialog.Header>
                    <AlertDialog.Body>This mirrors device, session, and agent revoke flows.</AlertDialog.Body>
                    <AlertDialog.Footer><AlertDialog.CloseTrigger>Cancel</AlertDialog.CloseTrigger><Button variant="danger">Revoke</Button></AlertDialog.Footer>
                  </AlertDialog.Dialog>
                </AlertDialog.Container>
              </AlertDialog.Backdrop>
            </AlertDialog>
          </Card.Content>
        </Card>

        <Card className="rounded-xl border border-white/10 bg-[#08080a]/80">
          <Card.Header>
            <Card.Title>Scheduling and Audit Filters</Card.Title>
            <Card.Description>Future calendar/date controls for scheduling and audit time filters.</Card.Description>
          </Card.Header>
          <Card.Content className="grid gap-3">
            <DatePicker aria-label="Audit date filter"><DatePicker.Trigger><CalendarDays className="h-4 w-4" /> Pick date</DatePicker.Trigger></DatePicker>
            <Calendar aria-label="Release calendar" />
            <Table>
              <Table.ScrollContainer>
                <Table.Content aria-label="Component table">
                  <Table.Header>
                    <Table.Column isRowHeader>Component</Table.Column>
                    <Table.Column>Workflow</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    <Table.Row id="approval"><Table.Cell>AlertDialog</Table.Cell><Table.Cell>Revocation</Table.Cell></Table.Row>
                    <Table.Row id="transfer"><Table.Cell>ProgressBar</Table.Cell><Table.Cell>Transfer status</Table.Cell></Table.Row>
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
            <div className="flex items-center gap-2 text-xs text-white/55">
              <Bell className="h-4 w-4" /> Toasts announce async workflow results.
            </div>
          </Card.Content>
        </Card>
      </div>
    </ScrollShadow>
  </div>
);
